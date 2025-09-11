import { Stagehand, Page } from "@browserbasehq/stagehand";
import { S3Uploader } from "./s3-upload.js";

export interface ScrapeConfig {
  daysBack: number;
  recordType: string;
}

export class ChathamRODScraper {
  private stagehand: Stagehand;
  private s3Uploader: S3Uploader;
  private config: ScrapeConfig;
  private sessionInfo: any;

  constructor(config: ScrapeConfig) {
    this.config = {
      daysBack: config.daysBack || 30,
      recordType: config.recordType || "DEED"
    };
    
    this.stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      disablePino: true,
      modelName: "deepseek/deepseek-chat",
      modelClientOptions: {
        apiKey: process.env.DEEPSEEK_API_KEY!,
        baseURL: "https://api.deepseek.com/v1",
        maxTokens: 4096,
        temperature: 0.1,
      },
      browserbaseSessionCreateParams: {
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        region: "us-west-2",
        browserSettings: {
          viewport: { width: 1920, height: 1080 },
          blockAds: true,
        },
        timeout: 300,
      },
      verbose: 2,
      domSettleTimeoutMs: 45000,
    });

    this.s3Uploader = new S3Uploader();
  }

  private calculateStartDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - this.config.daysBack);
    return `${(date.getMonth() + 1).toString().padStart(2, "0")}/${date
      .getDate()
      .toString()
      .padStart(2, "0")}/${date.getFullYear()}`;
  }

  async execute(): Promise<{ success: boolean; s3Path?: string; error?: string }> {
    try {
      // Initialize Stagehand session
      this.sessionInfo = await this.stagehand.init();
      console.log(`Session started: ${this.sessionInfo.sessionId}`);
      console.log(`Debug URL: ${this.sessionInfo.debugUrl}`);
      console.log(`Session URL: ${this.sessionInfo.sessionUrl}`);
      
      // Get the page from Stagehand (it's a Playwright Page object)
      const page = this.stagehand.page;

      // Step 1: Navigate to website
      console.log("Step 1: Navigating to Chatham County ROD...");
      await page.goto("https://www.chathamncrod.org/", {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForTimeout(2000);

      // Step 2: Click Acknowledge Disclaimer - Using Playwright selector
      console.log("Step 2: Acknowledging disclaimer...");
      await page.getByRole('link', { name: 'Acknowledge Disclaimer to' }).click();
      await page.waitForTimeout(3000);

      // Step 3: Click Full System - Using Playwright selector
      console.log("Step 3: Clicking Full System...");
      await page.locator('span').filter({ hasText: /^Full System$/ }).getByRole('link').click();
      await page.waitForTimeout(3000);

      // Step 4: Fill Start Date - Using exact ID from codegen
      console.log("Step 4: Setting start date...");
      const startDate = this.calculateStartDate();
      console.log(`Calculated start date: ${startDate}`);
      
      const startDateField = page.locator('#TRG_98');
      await startDateField.click();
      await startDateField.press('ControlOrMeta+a'); // Select all
      await startDateField.fill(startDate); // Use dynamic date
      await startDateField.press('Tab');
      await page.waitForTimeout(1000);

      // Step 5: Skip End Date (Tab through it as in codegen)
      await page.locator('#TRG_99').press('Tab');
      await page.waitForTimeout(500);

      // Step 6: Fill Instrument Type - Using exact ID from codegen
      console.log(`Step 6: Setting record type to ${this.config.recordType}...`);
      const instrTypeField = page.locator('#TRG_95');
      await instrTypeField.click();
      await instrTypeField.fill(this.config.recordType); // Use dynamic record type
      await page.waitForTimeout(1500);

      // Step 7: Click Search - Using Playwright selector
      console.log("Step 7: Initiating search...");
      await page.getByText('Search', { exact: true }).click();
      
      console.log("Waiting for search results to load...");
      await page.waitForTimeout(15000);

      // Step 8: Select all records - Using exact ID from codegen
      console.log("Step 8: Selecting all records...");
      await page.locator('#TRG_171').getByRole('cell').click();
      
      console.log("Waiting for all records to be selected...");
      await page.waitForTimeout(20000);

      // Step 9: Click Print Checked and handle popup
      console.log("Step 9: Clicking Print Checked and handling popup...");
      
      // Set up promise to catch the popup BEFORE clicking
      const popupPromise = page.waitForEvent('popup');
      
      // Click Print Checked
      await page.getByText('Print Checked', { exact: true }).click();
      
      // Wait for the popup to appear
      const printPage = await popupPromise as Page;
      console.log("Print preview popup opened");
      await printPage.waitForLoadState('networkidle');

      // Step 10: Download from the popup
      console.log("Step 10: Attempting to download document...");
      
      // Set up download handling on the popup page
      const downloadPromise = printPage.waitForEvent('download', { timeout: 60000 });
      
      // Try to trigger download on the popup
      try {
        // Try clicking print/download button if visible
        const downloadButton = printPage.locator('button:has-text("Download")') ||
                              printPage.locator('button:has-text("Save")') ||
                              printPage.locator('button:has-text("Print")');
        
        if (await downloadButton.isVisible({ timeout: 5000 })) {
          await downloadButton.click();
        } else {
          // Fallback to keyboard shortcut
          await printPage.keyboard.press('Control+s');
        }
      } catch (error) {
        console.log("Using keyboard shortcut for download...");
        await printPage.keyboard.press('Control+s');
      }
      
      // Wait for download to complete
      const download = await downloadPromise;
      const fileName = download.suggestedFilename() || `chatham-rod-${Date.now()}.pdf`;
      console.log(`Download started: ${fileName}`);
      
      // Convert download stream to buffer for S3
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });

      console.log(`Download completed: ${buffer.length} bytes`);

      // Step 11: Upload to S3
      console.log("Step 11: Uploading to S3...");
      const s3Path = await this.s3Uploader.uploadFile(buffer, fileName);
      console.log(`File uploaded successfully to: ${s3Path}`);

      // Clean up
      await this.stagehand.close();
      
      return {
        success: true,
        s3Path: s3Path,
      };

    } catch (error) {
      console.error("Scraping failed:", error);
      
      // Try to close stagehand on error
      try {
        await this.stagehand.close();
      } catch (closeError) {
        console.error("Failed to close Stagehand:", closeError);
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

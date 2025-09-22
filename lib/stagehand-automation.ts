import { Stagehand, Page } from "@browserbasehq/stagehand";
import { S3Uploader } from "./s3-upload.js";

export interface ScrapeConfig {
  daysBack: number;
  recordType: string;
}

export class MiamiDadeRODScraper {
  private stagehand: Stagehand;
  private s3Uploader: S3Uploader;
  private config: ScrapeConfig;
  private sessionInfo: any;

  constructor(config: ScrapeConfig) {
    this.config = {
      daysBack: config.daysBack || 30,
      recordType: config.recordType || "DEED - DEE"
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

  private calculateDateRange(): { startDate: string; endDate: string } {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - this.config.daysBack);
    
    // Format as YYYY-MM-DD for Miami-Dade
    const formatDate = (date: Date): string => {
      return `${date.getFullYear()}-${(date.getMonth() + 1)
        .toString()
        .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
    };
    
    return {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate)
    };
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

      // Calculate date range
      const { startDate, endDate } = this.calculateDateRange();

      // YOUR EXACT PLAYWRIGHT RECORDING CODE STARTS HERE
      console.log("Step 1: Navigating to Miami-Dade Clerk Official Records...");
      await page.goto('https://onlineservices.miamidadeclerk.gov/officialrecords');
      await page.waitForTimeout(3000);

      console.log("Step 2: Clicking Name/Document button...");
      await page.getByRole('button', { name: 'Name/Document' }).click();
      await page.waitForTimeout(3000);

      console.log("Step 3: Selecting Company...");
      await page.locator('div').filter({ hasText: /^Company$/ }).click();
      await page.waitForTimeout(2000);

      console.log(`Step 4: Selecting document type: ${this.config.recordType}...`);
      await page.locator('#documentType').selectOption(this.config.recordType);
      await page.waitForTimeout(2000);

      console.log(`Step 5: Setting date range from ${startDate} to ${endDate}...`);
      await page.locator('#dateRangeFrom').fill(startDate);
      await page.waitForTimeout(1000);
      
      await page.locator('#dateRangeTo').fill(endDate);
      await page.waitForTimeout(1000);

      console.log("Step 6: Clicking Search button...");
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      // YOUR EXACT PLAYWRIGHT RECORDING CODE ENDS HERE

      console.log("Waiting for search results to load...");
      await page.waitForTimeout(20000);

      // Step 7: Select all records
      console.log("Step 7: Selecting all records...");
      try {
        // Try to find select all checkbox - you'll need to update based on actual Miami-Dade selectors
        const selectAllCheckbox = page.locator('input[type="checkbox"][title*="Select All"], #selectAll, .select-all-checkbox').first();
        if (await selectAllCheckbox.isVisible({ timeout: 5000 })) {
          await selectAllCheckbox.click();
          console.log("Selected all records");
        } else {
          console.log("Select all not found, trying individual checkboxes...");
          const checkboxes = await page.locator('input[type="checkbox"]:visible').all();
          for (let i = 0; i < Math.min(checkboxes.length, 50); i++) {
            await checkboxes[i].click();
            await page.waitForTimeout(200);
          }
        }
      } catch (error) {
        console.log("Could not select records:", error);
      }
      
      await page.waitForTimeout(10000);

      // Step 8: Look for Print/Export button and handle popup
      console.log("Step 8: Looking for Print/Export/Download option...");
      
      // Set up promise to catch popup BEFORE clicking
      const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
      
      // Try to find export/download button - adjust these based on Miami-Dade's actual buttons
      const exportButtons = [
        page.getByText('Print Checked'),
        page.getByText('Print Selected'),
        page.getByText('Export'),
        page.getByText('Download'),
        page.getByText('Export CSV'),
        page.getByText('Download CSV'),
        page.locator('button:has-text("Export")').first(),
        page.locator('button:has-text("Download")').first(),
      ];

      let buttonClicked = false;
      for (const button of exportButtons) {
        if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log("Found export button, clicking...");
          await button.click();
          buttonClicked = true;
          break;
        }
      }

      if (!buttonClicked) {
        console.log("No export button found, taking screenshot for debugging...");
        await page.screenshot({ path: 'miami-dade-no-button.png', fullPage: true });
        throw new Error("Could not find Print/Export/Download button");
      }

      // Wait for popup or direct download
      const printPage = await popupPromise;
      
      let downloadBuffer: Buffer;
      let fileName: string;

      if (printPage) {
        console.log("Print preview popup opened");
        await (printPage as Page).waitForLoadState('networkidle');

        // Step 9: Download from popup
        console.log("Step 9: Attempting to download from popup...");
        
        // Set up download promise
        const downloadPromise = (printPage as Page).waitForEvent('download', { timeout: 60000 });
        
        // Try to trigger download
        try {
          const downloadButton = (printPage as Page).locator('button:has-text("Download"), button:has-text("Save")').first();
          if (await downloadButton.isVisible({ timeout: 3000 })) {
            await downloadButton.click();
          } else {
            // Fallback to keyboard shortcut
            await (printPage as Page).keyboard.press('Control+s');
          }
        } catch {
          console.log("Using keyboard shortcut for download...");
          await (printPage as Page).keyboard.press('Control+s');
        }
        
        // Wait for download
        const download = await downloadPromise;
        fileName = download.suggestedFilename() || `miami-dade-rod-${Date.now()}.pdf`;
        console.log(`Download started: ${fileName}`);
        
        // Convert download stream to buffer for S3
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        downloadBuffer = await new Promise<Buffer>((resolve, reject) => {
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });

      } else {
        // No popup, try direct download
        console.log("No popup detected, attempting direct download...");
        const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
        
        // Try to trigger download with keyboard shortcut
        await page.keyboard.press('Control+s');
        
        const download = await downloadPromise;
        fileName = download.suggestedFilename() || `miami-dade-rod-${Date.now()}.pdf`;
        console.log(`Download started: ${fileName}`);
        
        // Convert to buffer
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        downloadBuffer = await new Promise<Buffer>((resolve, reject) => {
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      }

      console.log(`Download completed: ${downloadBuffer.length} bytes`);

      // Step 10: Upload to S3
      console.log("Step 10: Uploading to S3...");
      const s3Path = await this.s3Uploader.uploadFile(downloadBuffer, fileName);
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

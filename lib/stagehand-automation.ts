import { Stagehand, Page } from "@browserbasehq/stagehand";
import { S3Uploader } from "./s3-upload.js";  // ADD .js HERE

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
    
    // Using DeepSeek for cost efficiency
    this.stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      modelName: "deepseek/deepseek-chat",
      modelClientOptions: {
        apiKey: process.env.DEEPSEEK_API_KEY!,
        baseURL: "https://api.deepseek.com/v1",
      },
      browserbaseSessionCreateParams: {
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        region: "us-west-2",
        browserSettings: {
          viewport: { width: 1920, height: 1080 },
          blockAds: true,
        },
        timeout: 300000, // 5 minutes
      },
      verbose: 1,
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
      // Initialize and capture session info
      this.sessionInfo = await this.stagehand.init();
      console.log(`Session started: ${this.sessionInfo.sessionId}`);
      console.log(`Debug URL: ${this.sessionInfo.debugUrl}`);
      console.log(`Session URL: ${this.sessionInfo.sessionUrl}`);
      
      const page = this.stagehand.page;

      // Step 1: Navigate to the website
      console.log("Step 1: Navigating to Chatham County ROD...");
      await page.goto("https://www.chathamncrod.org/", {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForTimeout(3000);

      // Step 2: Click Acknowledge Disclaimer
      console.log("Step 2: Acknowledging disclaimer...");
      await page.act("Click the 'Acknowledge Disclaimer to begin searching records' button");
      await page.waitForTimeout(3000);

      // Step 3: Click Full System
      console.log("Step 3: Clicking Full System...");
      await page.act("Click 'Full System' which is to the left of 'Indexing and Imaging Combined Retrieval'");
      await page.waitForTimeout(3000);

      // Step 4: Select Recorded Date
      console.log("Step 4: Selecting Recorded Date option...");
      await page.act("Select or click the 'Recorded Date' option");
      await page.waitForTimeout(2000);

      // Step 5: Handle Start Date field with retry logic
      console.log("Step 5: Setting start date...");
      const startDate = this.calculateStartDate();
      console.log(`Calculated start date: ${startDate}`);
      
      // Try clicking the Start Date field with retry
      try {
        await page.act("Click the Start Date input field or box");
        await page.waitForTimeout(1000);
      } catch (error) {
        // If error, click out and back in as instructed
        console.log("Retrying Start Date field click...");
        await page.act("Click somewhere else on the page outside the date field");
        await page.waitForTimeout(500);
        await page.act("Click the Start Date input field or box again");
        await page.waitForTimeout(1000);
      }

      // Step 6: Navigate calendar and set date
      console.log("Step 6: Navigating calendar and setting date...");
      
      // Click the left arrow to go back one month
      await page.act("Click the left arrow in the top left corner of the calendar popup to go back one month");
      await page.waitForTimeout(1000);
      
      // Enter the date using variables
      await page.act({
        action: "Type or enter the date %startDate% in the date field in MM/DD/YYYY format",
        variables: { startDate: startDate }
      });
      await page.waitForTimeout(1500);

      // Step 7: Set Record Type (BEFORE searching)
      console.log(`Step 7: Setting record type to ${this.config.recordType}...`);
      await page.act({
        action: "In the text box to the left of 'INSTR type(S) (SEP by comma)', clear any existing text and type %recordType%",
        variables: { recordType: this.config.recordType }
      });
      await page.waitForTimeout(1500);

      // Step 8: Click Search
      console.log("Step 8: Initiating search...");
      await page.act("Click the 'Search' button in the top left corner");
      
      // Wait for search results to load
      console.log("Waiting for search results to load...");
      await page.waitForTimeout(15000); // Give search time to complete

      // Step 9: Select all records via topmost checkbox
      console.log("Step 9: Selecting all records (this may take a while due to buggy interface)...");
      await page.act("Click the topmost checkbox in the topmost left corner of the results table to select all records");
      
      // Wait for all checkboxes to be selected (this is buggy and slow as mentioned)
      console.log("Waiting for all records to be selected (buggy interface, please be patient)...");
      await page.waitForTimeout(20000); // Give plenty of time for selection

      // Step 10: Click Print Checked
      console.log("Step 10: Clicking Print Checked button...");
      await page.act("Click the 'Print Checked' button");
      
      // Step 11: Handle new tab
      console.log("Step 11: Waiting for print preview tab to open...");
      await page.waitForTimeout(5000);
      
      // Get all pages/tabs using Stagehand context
      const pages = this.stagehand.context.pages();
      console.log(`Found ${pages.length} tabs`);
      
      let printPage: Page;
      if (pages.length > 1) {
        // Switch to the new tab (usually the last one)
        printPage = pages[pages.length - 1] as Page;
        console.log("Switched to print preview tab");
      } else {
        printPage = page;
        console.log("Using same tab for print preview");
      }

      // Step 12: Download the document
      console.log("Step 12: Attempting to download document...");
      
      // Set up download handling
      const downloadPromise = printPage.waitForEvent('download', { timeout: 30000 });
      
      // Try multiple approaches to trigger download
      try {
        await printPage.act("Click the download button, save button, or print button in the print preview");
      } catch (error) {
        console.log("First download attempt failed, trying alternative...");
        await printPage.act("Press Ctrl+S or Command+S to save the document");
      }
      
      // Wait for download
      const download = await downloadPromise;
      const fileName = download.suggestedFilename() || `chatham-rod-${Date.now()}.pdf`;
      console.log(`Download started: ${fileName}`);
      
      // Convert download to buffer
      const buffer = await download.createReadStream().then(stream => {
        const chunks: Buffer[] = [];
        return new Promise<Buffer>((resolve, reject) => {
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      });

      console.log(`Download completed: ${buffer.length} bytes`);

      // Step 13: Upload to S3
      console.log("Step 13: Uploading to S3...");
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

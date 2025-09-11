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
      this.sessionInfo = await this.stagehand.init();
      console.log(`Session started: ${this.sessionInfo.sessionId}`);
      console.log(`Debug URL: ${this.sessionInfo.debugUrl}`);
      
      const page = this.stagehand.page;

      // Step 1: Navigate
      console.log("Step 1: Navigating to Chatham County ROD...");
      await page.goto("https://www.chathamncrod.org/", {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForTimeout(3000);

      // Step 2: Acknowledge Disclaimer (Keep Stagehand - this works)
      console.log("Step 2: Acknowledging disclaimer...");
      await page.act("Click the 'Acknowledge Disclaimer to begin searching records' button");
      await page.waitForTimeout(3000);

      // Step 3: Full System (Keep Stagehand - this works)
      console.log("Step 3: Clicking Full System...");
      await page.act("Click the 'Full System' link or button which is located to the left of 'Indexing and Imaging Combined Retrieval'");
      await page.waitForTimeout(3000);

      // Step 4: Recorded Date (Keep Stagehand - this works)
      console.log("Step 4: Selecting Recorded Date option...");
      await page.act("Click or select the 'Recorded Date' button");
      await page.waitForTimeout(3000);

      // Step 5: Start Date - USE PLAYWRIGHT DIRECTLY
      console.log("Step 5: Setting start date with Playwright...");
      const startDate = this.calculateStartDate();
      console.log(`Calculated start date: ${startDate}`);
      
      // Wait for the date input to be visible
      await page.waitForSelector('input[type="text"]', { timeout: 10000 });
      
      // Find the Start Date input using multiple possible selectors
      const startDateInput = await page.$('input[placeholder*="mm/dd/yyyy"]') || 
                            await page.$('input[name*="startDate"]') ||
                            await page.$('input[name*="StartDate"]') ||
                            await page.$('label:has-text("Start Date") + input') ||
                            await page.$('xpath=//label[contains(text(), "Start Date")]/following-sibling::input[1]') ||
                            await page.$('xpath=//input[@type="text"][1]'); // First text input as fallback
      
      if (startDateInput) {
        await startDateInput.click();
        await page.waitForTimeout(500);
        
        // Clear the field first
        await startDateInput.click({ clickCount: 3 }); // Triple click to select all
        await page.keyboard.press('Backspace');
        
        // Type the date
        await startDateInput.type(startDate, { delay: 50 });
        await page.waitForTimeout(500);
        
        // Tab out to close any calendar popup
        await page.keyboard.press('Tab');
        await page.waitForTimeout(1000);
      } else {
        console.log("Could not find Start Date input with Playwright, falling back to Stagehand...");
        await page.act({
          action: "Click on the text input box next to 'Start Date (mm/dd/yyyy)' and type %startDate%",
          variables: { startDate: startDate }
        });
      }

      // Step 6: Record Type - USE PLAYWRIGHT DIRECTLY
      console.log(`Step 6: Setting record type to ${this.config.recordType} with Playwright...`);
      
      // Find the instrument type input
      const instrTypeInput = await page.$('input[placeholder*="INSTR"]') ||
                            await page.$('label:has-text("Instr Type") + input') ||
                            await page.$('xpath=//label[contains(text(), "Instr Type")]/following-sibling::input[1]') ||
                            await page.$('xpath=//input[contains(@placeholder, "SEP by comma")]') ||
                            await page.$('xpath=//td[contains(text(), "Instr Type")]/following-sibling::td/input');
      
      if (instrTypeInput) {
        await instrTypeInput.click();
        await instrTypeInput.click({ clickCount: 3 }); // Select all
        await instrTypeInput.type(this.config.recordType, { delay: 50 });
        await page.waitForTimeout(1000);
      } else {
        console.log("Could not find Instrument Type input with Playwright, falling back to Stagehand...");
        await page.act({
          action: "In the text field for 'Instr Type(s)', type %recordType%",
          variables: { recordType: this.config.recordType }
        });
      }

      // Step 7: Search Button - USE PLAYWRIGHT DIRECTLY
      console.log("Step 7: Clicking Search with Playwright...");
      
      // Multiple selectors for the search button
      const searchButton = await page.$('button:has-text("Search")') ||
                          await page.$('input[type="button"][value="Search"]') ||
                          await page.$('input[type="submit"][value="Search"]') ||
                          await page.$('xpath=//button[contains(text(), "Search")]') ||
                          await page.$('xpath=//input[@value="Search"]');
      
      if (searchButton) {
        await searchButton.click();
      } else {
        console.log("Could not find Search button with Playwright, falling back to Stagehand...");
        await page.act("Click the 'Search' button");
      }
      
      console.log("Waiting for search results to load...");
      await page.waitForTimeout(15000);

      // Step 8: Select all checkbox - Try Playwright first
      console.log("Step 8: Selecting all records...");
      
      // Wait for results table
      await page.waitForSelector('table', { timeout: 10000 }).catch(() => {
        console.log("No table found, proceeding anyway...");
      });
      
      // Try to find the header checkbox
      const selectAllCheckbox = await page.$('th input[type="checkbox"]') ||
                               await page.$('thead input[type="checkbox"]') ||
                               await page.$('xpath=//th[text()="C"]/input[@type="checkbox"]') ||
                               await page.$('xpath=//th[1]/input[@type="checkbox"]');
      
      if (selectAllCheckbox) {
        await selectAllCheckbox.click();
      } else {
        console.log("Using Stagehand for checkbox...");
        await page.act("Click the checkbox in the header row under column 'C' to select all records");
      }
      
      console.log("Waiting for all records to be selected...");
      await page.waitForTimeout(20000);

      // Step 9: Print Checked - Keep Stagehand
      console.log("Step 9: Clicking Print Checked button...");
      await page.act("Click the 'Print Checked' button");
      
      // Step 10: Handle new tab
      console.log("Step 10: Waiting for print preview tab to open...");
      await page.waitForTimeout(5000);
      
      const pages = this.stagehand.context.pages();
      console.log(`Found ${pages.length} tabs`);
      
      let printPage: Page;
      if (pages.length > 1) {
        printPage = pages[pages.length - 1] as Page;
        console.log("Switched to print preview tab");
      } else {
        printPage = page;
      }

      // Step 11: Download
      console.log("Step 11: Attempting to download document...");
      
      const downloadPromise = printPage.waitForEvent('download', { timeout: 60000 });
      
      try {
        await printPage.act("Click the download button or save button");
      } catch (error) {
        console.log("Trying keyboard shortcut...");
        await printPage.keyboard.press('Control+s');
      }
      
      const download = await downloadPromise;
      const fileName = download.suggestedFilename() || `chatham-rod-${Date.now()}.pdf`;
      console.log(`Download started: ${fileName}`);
      
      const buffer = await download.createReadStream().then(stream => {
        const chunks: Buffer[] = [];
        return new Promise<Buffer>((resolve, reject) => {
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      });

      console.log(`Download completed: ${buffer.length} bytes`);

      // Step 12: Upload to S3
      console.log("Step 12: Uploading to S3...");
      const s3Path = await this.s3Uploader.uploadFile(buffer, fileName);
      console.log(`File uploaded successfully to: ${s3Path}`);

      await this.stagehand.close();
      
      return {
        success: true,
        s3Path: s3Path,
      };

    } catch (error) {
      console.error("Scraping failed:", error);
      
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

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MiamiDadeRODScraper, ScrapeConfig } from "../lib/stagehand-automation.js";
import { z } from "zod";

// REST OF YOUR CODE STAYS EXACTLY THE SAME - NO OTHER CHANGES

// Request validation schema
const RequestSchema = z.object({
  daysBack: z.number().min(1).max(365).default(30),
  recordType: z.string().default("DEED"),
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only allow POST requests
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // Validate request body
    const config = RequestSchema.parse(req.body || {});

    console.log(`Starting scrape with config:`, config);

    // Create and run scraper
    const scraper = new MiamiDadeRODScraper(config as ScrapeConfig);
    const result = await scraper.execute();

    if (result.success) {
      res.status(200).json({
        ok: true,
        message: "Scraping completed successfully",
        s3Path: result.s3Path,
      });
    } else {
      res.status(500).json({
        ok: false,
        error: result.error || "Scraping failed",
      });
    }
  } catch (error) {
    console.error("Handler error:", error);
    
    if (error instanceof z.ZodError) {
      res.status(400).json({
        ok: false,
        error: "Invalid request parameters",
        details: error.errors,
      });
    } else {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  }
}

// Increase timeout for this function
export const config = {
  maxDuration: 300, // 5 minutes
};

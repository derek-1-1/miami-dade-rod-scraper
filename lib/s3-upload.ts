import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export class S3Uploader {
  private s3Client: S3Client;
  private bucketName: string;

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    this.bucketName = process.env.S3_BUCKET_NAME!;
  }

  async uploadFile(fileBuffer: Buffer, fileName: string): Promise<string> {
    const key = `chatham-rod/${new Date().toISOString().split("T")[0]}/${fileName}`;
    
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: "application/pdf",
    });

    await this.s3Client.send(command);
    return `s3://${this.bucketName}/${key}`;
  }
}

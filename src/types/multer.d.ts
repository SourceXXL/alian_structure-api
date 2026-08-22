/**
 * Express.Multer type augmentation.
 * The @types/multer package augments Express.Multer but the namespace
 * may not resolve in all TS configurations. This declaration ensures
 * the File type is available globally.
 */
declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      destination: string;
      filename: string;
      path: string;
      buffer: Buffer;
      stream: import("stream").Readable;
    }
  }
}

/**
 * Stub declarations for optional cloud SDKs.
 * These packages are dynamically imported at runtime and only needed
 * when the respective storage backend is active.
 */
declare module "@aws-sdk/client-s3" {
  export class S3Client {
    constructor(config: any);
    send(command: any): Promise<any>;
  }
  export class PutObjectCommand {
    constructor(params: any);
  }
  export class GetObjectCommand {
    constructor(params: any);
  }
  export class DeleteObjectCommand {
    constructor(params: any);
  }
  export class HeadObjectCommand {
    constructor(params: any);
  }
  export class CopyObjectCommand {
    constructor(params: any);
  }
  export class ListObjectsV2Command {
    constructor(params: any);
  }
}

declare module "@aws-sdk/s3-request-presigner" {
  export function getSignedUrl(
    client: any,
    command: any,
    options?: { expiresIn?: number },
  ): Promise<string>;
}

declare module "@azure/storage-blob" {
  export class BlobServiceClient {
    static fromConnectionString(connectionString: string): BlobServiceClient;
    getContainerClient(containerName: string): ContainerClient;
  }
  export class ContainerClient {
    createIfNotExists(options?: any): Promise<any>;
    getBlockBlobClient(blobName: string): BlockBlobClient;
    listBlobsFlat(options?: any): AsyncIterable<any>;
  }
  export class BlockBlobClient {
    upload(data: any, size: number, options?: any): Promise<any>;
    download(offset?: number): Promise<{ readableStreamBody: any }>;
    delete(): Promise<any>;
    getProperties(): Promise<any>;
    beginCopyFromURL(sourceUrl: string): Promise<any>;
    get url(): string;
  }
  export function generateBlobSASQueryParameters(
    permissions: any,
    connectionString: string,
  ): { toString(): string };
  export class BlobSASPermissions {
    static parse(permissions: string): any;
  }
}

declare module "sharp" {
  interface Sharp {
    resize(width: number, height: number, options?: any): Sharp;
    webp(options?: any): Sharp;
    toFormat(format: string): Sharp;
    toBuffer(): Promise<Buffer>;
  }
  function sharp(input?: any): Sharp;
  export default sharp;
}

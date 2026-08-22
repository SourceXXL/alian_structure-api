/**
 * TypeScript Client Example
 *
 * This example demonstrates how to use the auto-generated TypeScript client
 * to interact with the alian-structure API.
 */

import {
  Configuration,
  DefaultApi,
  AuthApi,
  PortfolioApi,
  OracleApi,
} from "@alian-structure/api-client";

class AlianStructureClient {
  private configuration: Configuration;
  private defaultApi: DefaultApi;
  private authApi: AuthApi;
  private portfolioApi: PortfolioApi;
  private oracleApi: OracleApi;

  constructor(
    baseUrl: string = "https://api.alian-structure.com",
    apiKey?: string,
  ) {
    this.configuration = new Configuration({
      basePath: baseUrl,
      accessToken: apiKey,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.defaultApi = new DefaultApi(this.configuration);
    this.authApi = new AuthApi(this.configuration);
    this.portfolioApi = new PortfolioApi(this.configuration);
    this.oracleApi = new OracleApi(this.configuration);
  }

  async authenticateWithWallet(walletAddress: string, signature: string) {
    try {
      const response = await this.authApi.authVerifyPost({
        address: walletAddress,
        message: `Sign this message to authenticate with alian-structure`,
        signature: signature,
      });

      this.configuration.accessToken = response.access_token;
      return response;
    } catch (error) {
      console.error("Authentication failed:", error);
      throw error;
    }
  }

  async createPortfolio(name: string, description?: string) {
    try {
      const response = await this.portfolioApi.portfolioPortfoliosPost({
        name: name,
        description: description || "",
        assets: [],
      });
      return response;
    } catch (error) {
      console.error("Portfolio creation failed:", error);
      throw error;
    }
  }

  async getPortfolios(page: number = 1, pageSize: number = 10) {
    try {
      const response = await this.portfolioApi.portfolioPortfoliosGet({
        page: page,
        pageSize: pageSize,
      });
      return response;
    } catch (error) {
      console.error("Failed to fetch portfolios:", error);
      throw error;
    }
  }

  async submitOraclePayload(payloadType: string, data: Record<string, any>) {
    try {
      const createResponse = await this.oracleApi.oraclePayloadsPost({
        payloadType: payloadType,
        data: data,
      });

      const signResponse = await this.oracleApi.oraclePayloadsIdSignPost(
        createResponse.id,
        {
          privateKey: process.env.WALLET_PRIVATE_KEY!,
        },
      );

      const submitResponse = await this.oracleApi.oraclePayloadsIdSubmitPost(
        signResponse.id,
      );

      return submitResponse;
    } catch (error) {
      console.error("Oracle submission failed:", error);
      throw error;
    }
  }

  async healthCheck() {
    try {
      const response = await this.defaultApi.healthGet();
      return response;
    } catch (error) {
      console.error("Health check failed:", error);
      throw error;
    }
  }
}

async function main() {
  const client = new AlianStructureClient("http://localhost:3001");

  try {
    console.log("🔍 Checking API health...");
    const health = await client.healthCheck();
    console.log("✅ API is healthy");

    console.log("\n💼 Fetching portfolios...");
    const portfolios = await client.getPortfolios(1, 5);
    console.log("✅ Portfolios fetched");

    console.log("\n📊 Creating new portfolio...");
    const newPortfolio = await client.createPortfolio(
      "My Investment Portfolio",
      "A portfolio for long-term investments",
    );
    console.log("✅ Portfolio created");
  } catch (error) {
    console.error("❌ Error during execution:", error);
    process.exit(1);
  }
}

export { AlianStructureClient };

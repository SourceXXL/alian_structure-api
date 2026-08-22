#!/usr/bin/env python3
"""
Python Client Example

This example demonstrates how to use the auto-generated Python client
to interact with the alian-structure API.
"""

import os
from typing import Optional, Dict, Any
import alian_structure_api
from alian_structure_api.apis import DefaultApi, AuthApi, PortfolioApi, OracleApi


class AlianStructureClient:
    """
    A wrapper client for the alian-structure API with convenient methods.
    """

    def __init__(
        self,
        base_url: str = "https://api.alian-structure.com",
        api_key: Optional[str] = None,
        jwt_token: Optional[str] = None,
    ):
        """
        Initialize the API client.
        """
        config = alian_structure_api.Configuration(
            host=base_url,
            api_key=api_key,
            access_token=jwt_token,
        )

        self.client = alian_structure_api.ApiClient(config)
        self.default_api = DefaultApi(self.client)
        self.auth_api = AuthApi(self.client)
        self.portfolio_api = PortfolioApi(self.client)
        self.oracle_api = OracleApi(self.client)

    def set_jwt_token(self, token: str):
        """Update the JWT token for authenticated requests."""
        self.client.default_headers["Authorization"] = f"Bearer {token}"

    def authenticate_with_wallet(
        self, wallet_address: str, message: str, signature: str
    ) -> Dict[str, Any]:
        """
        Authenticate using wallet signature (Web3 authentication).
        """
        try:
            response = self.auth_api.auth_verify_post(
                address=wallet_address,
                message=message,
                signature=signature,
            )
            if hasattr(response, "access_token"):
                self.set_jwt_token(response.access_token)
            return response.to_dict()
        except Exception as e:
            print(f"❌ Authentication failed: {e}")
            raise

    def create_portfolio(
        self, name: str, description: str = "", assets: Optional[list] = None
    ) -> Dict[str, Any]:
        """
        Create a new portfolio.
        """
        try:
            portfolio_dto = alian_structure_api.models.CreatePortfolioDto(
                name=name,
                description=description,
                assets=assets or [],
            )
            response = self.portfolio_api.portfolio_portfolios_post(portfolio_dto)
            return response.to_dict()
        except Exception as e:
            print(f"❌ Portfolio creation failed: {e}")
            raise

    def get_portfolios(
        self, page: int = 1, page_size: int = 10
    ) -> Dict[str, Any]:
        """
        Get user's portfolios.
        """
        try:
            response = self.portfolio_api.portfolio_portfolios_get(
                page=page, page_size=page_size
            )
            return response.to_dict()
        except Exception as e:
            print(f"❌ Failed to fetch portfolios: {e}")
            raise

    def submit_oracle_payload(
        self, payload_type: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Submit data to the Oracle (3-step process).
        """
        try:
            print("📝 Creating Oracle payload...")
            create_dto = alian_structure_api.models.CreatePayloadDto(
                payload_type=payload_type,
                data=data,
            )
            create_response = self.oracle_api.oracle_payloads_post(create_dto)
            payload_id = create_response.id

            print(f"🔏 Signing payload {payload_id}...")
            sign_dto = alian_structure_api.models.SignPayloadDto(
                private_key=os.getenv("WALLET_PRIVATE_KEY")
            )
            sign_response = self.oracle_api.oracle_payloads_id_sign_post(
                payload_id, sign_dto
            )

            print(f"⛓️  Submitting to blockchain...")
            submit_dto = alian_structure_api.models.SubmitPayloadDto()
            submit_response = self.oracle_api.oracle_payloads_id_submit_post(
                sign_response.id, submit_dto
            )

            return submit_response.to_dict()
        except Exception as e:
            print(f"❌ Oracle submission failed: {e}")
            raise

    def health_check(self) -> Dict[str, Any]:
        """Check if the API is healthy."""
        try:
            response = self.default_api.health_get()
            return response.to_dict()
        except Exception as e:
            print(f"❌ Health check failed: {e}")
            raise


def main():
    """Example usage of the AlianStructureClient."""

    client = AlianStructureClient("http://localhost:3001")

    try:
        print("🔍 Checking API health...")
        health = client.health_check()
        print(f"✅ API is healthy")

        print("\n💼 Fetching portfolios...")
        portfolios = client.get_portfolios(page=1, page_size=5)
        print(f"✅ Portfolios fetched")

        print("\n📊 Creating new portfolio...")
        new_portfolio = client.create_portfolio(
            name="My Investment Portfolio",
            description="A portfolio for long-term investments",
        )
        print(f"✅ Portfolio created")

    except Exception as e:
        print(f"\n❌ Error during execution: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())

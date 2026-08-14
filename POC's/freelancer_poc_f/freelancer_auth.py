"""
Phase 1: OAuth2 Token Acquisition module for Freelancer.com API
Uses Client Credentials Grant to obtain an access_token.
"""

import os
import sys
import requests
from dotenv import load_dotenv

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(ENV_PATH)

FLN_CLIENT_ID = os.getenv("FLN_CLIENT_ID")
FLN_CLIENT_SECRET = os.getenv("FLN_CLIENT_SECRET")

TOKEN_ENDPOINTS = [
    "https://accounts.freelancer.com/oauth/token",
    "https://accounts.freelancer-sandbox.com/oauth/token",
]


def get_access_token() -> str | None:
    if not FLN_CLIENT_ID or not FLN_CLIENT_SECRET:
        print("ERROR: FLN_CLIENT_ID or FLN_CLIENT_SECRET missing in .env", file=sys.stderr)
        return None

    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    payload = {
        "grant_type": "client_credentials",
        "client_id": FLN_CLIENT_ID,
        "client_secret": FLN_CLIENT_SECRET,
    }

    for endpoint in TOKEN_ENDPOINTS:
        print(f"Attempting token request to: {endpoint}...")
        try:
            res = requests.post(endpoint, data=payload, headers=headers, timeout=15)
            print(f"HTTP Status: {res.status_code}")
            if res.status_code == 200:
                data = res.json()
                token = data.get("access_token")
                print(f"SUCCESS! Received access_token (Expires in: {data.get('expires_in')} seconds)")
                return token
            else:
                print(f"Response Body: {res.text}")
        except Exception as e:
            print(f"Failed to connect to {endpoint}: {e}")

    return None


if __name__ == "__main__":
    token = get_access_token()
    if token:
        print("Token test PASSED!")
    else:
        print("Token test FAILED!", file=sys.stderr)
        sys.exit(1)

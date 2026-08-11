"""Unipile API Client POC for LinkedIn Automated Outreach & Direct Messaging.

This module handles:
  1. Sending personalized LinkedIn connection invitations (POST /api/v1/users/invite).
  2. Sending direct 1-to-1 LinkedIn messages / InMail (POST /api/v1/chats).
  3. Hydrating 1st-degree connection contact info (Email & Phone).
  4. Webhook response tracking (Invitation Accepted, Reply Received).

Note: Tested on personal LinkedIn accounts for Proof of Concept (POC) validation.
"""

from __future__ import annotations

import json
import os
import time

import requests

from logger import get_logger

log = get_logger(__name__)

UNIPILE_BASE_URL = os.getenv("UNIPILE_DSN", "https://api.unipile.com/api/v1").rstrip("/")


class UnipileClient:
    def __init__(self, api_key: str | None = None, account_id: str | None = None, timeout: int = 30):
        self.api_key = api_key or os.getenv("UNIPILE_API_KEY", "").strip()
        self.account_id = account_id or os.getenv("UNIPILE_ACCOUNT_ID", "").strip()
        self.timeout = timeout
        self.headers = {
            "X-API-KEY": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def send_connection_invite(self, linkedin_profile_url: str, message: str) -> dict:
        """Send a personalized LinkedIn connection invitation to a candidate profile."""
        url = f"{UNIPILE_BASE_URL}/users/invite"
        payload = {
            "account_id": self.account_id,
            "provider_id": linkedin_profile_url,
            "message": message,
        }
        log.info("Sending Unipile connection invite to: %s", linkedin_profile_url)
        try:
            resp = requests.post(url, headers=self.headers, json=payload, timeout=self.timeout)
            resp.raise_for_status()
            res = resp.json()
            log.info("Invite sent successfully: %s", res.get("invitation_id"))
            return res
        except requests.exceptions.RequestException as err:
            log.error("Unipile invite failed for %s: %s", linkedin_profile_url, err)
            return {"status": "error", "error": str(err)}

    def send_direct_message(self, linkedin_profile_url: str, text: str) -> dict:
        """Send a 1-to-1 direct LinkedIn message / InMail to an enriched candidate profile."""
        url = f"{UNIPILE_BASE_URL}/chats"
        payload = {
            "account_id": self.account_id,
            "attendees_ids": [linkedin_profile_url],
            "text": text,
        }
        log.info("Sending Unipile direct message to: %s", linkedin_profile_url)
        try:
            resp = requests.post(url, headers=self.headers, json=payload, timeout=self.timeout)
            resp.raise_for_status()
            res = resp.json()
            log.info("Message delivered successfully: %s", res.get("chat_id"))
            return res
        except requests.exceptions.RequestException as err:
            log.error("Unipile DM failed for %s: %s", linkedin_profile_url, err)
            return {"status": "error", "error": str(err)}

    def fetch_1st_degree_contact(self, provider_id: str) -> dict:
        """Retrieve 1st-degree contact details (email & phone) after connection acceptance."""
        url = f"{UNIPILE_BASE_URL}/users/{provider_id}"
        try:
            resp = requests.get(url, headers=self.headers, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
            return {
                "email": data.get("email"),
                "phone": data.get("phone"),
                "headline": data.get("headline"),
            }
        except requests.exceptions.RequestException as err:
            log.warning("Could not fetch 1st-degree contact for %s: %s", provider_id, err)
            return {"email": None, "phone": None}

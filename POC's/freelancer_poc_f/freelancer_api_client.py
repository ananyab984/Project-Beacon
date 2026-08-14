"""
Phase 2 & 3: Freelancer REST API Client
Provides endpoint calls for token sanity checks, job category discovery,
direct user profile lookup, and directory searching.
"""

import os
import sys
import json
import requests
from freelancer_auth import get_access_token

BASE_URL = "https://www.freelancer.com/api"


class FreelancerAPIClient:
    def __init__(self):
        self.access_token = get_access_token()
        if not self.access_token:
            raise RuntimeError("Failed to obtain Freelancer OAuth access_token.")
        self.headers = {
            "Freelancer-OAuth-V1": self.access_token,
            "Content-Type": "application/json",
        }

    def sanity_check(self) -> bool:
        url = f"{BASE_URL}/projects/0.1/jobs/?seo_details=false"
        res = requests.get(url, headers=self.headers, timeout=15)
        if res.status_code == 200:
            result = res.json().get("result", {})
            jobs = result.get("jobs", [])
            print(f"Sanity Check PASSED! Successfully retrieved {len(jobs)} job category definitions.")
            return True
        else:
            print(f"Sanity Check FAILED: Status {res.status_code} - {res.text}", file=sys.stderr)
            return False

    def get_job_skills(self) -> list:
        url = f"{BASE_URL}/projects/0.1/jobs/?seo_details=false"
        res = requests.get(url, headers=self.headers, timeout=15)
        res.raise_for_status()
        return res.json().get("result", {}).get("jobs", [])

    def get_user_by_username(self, username: str) -> dict | None:
        """
        Direct user profile lookup by username.
        Queries GET /api/users/0.1/users/self_or_by_username/
        or GET /api/users/0.1/users/?usernames[]={username}&reputation=true&jobs=true&portfolio=true
        """
        url = f"{BASE_URL}/users/0.1/users/"
        params = {
            "usernames[]": [username],
            "reputation": "true",
            "jobs": "true",
            "portfolio": "true",
            "display_info": "true",
            "country_details": "true",
            "qualification_details": "true"
        }
        res = requests.get(url, headers=self.headers, params=params, timeout=15)
        if res.status_code == 200:
            result = res.json().get("result", {})
            users = result.get("users", {})
            if isinstance(users, dict):
                for uid, udata in users.items():
                    if udata.get("username", "").lower() == username.lower():
                        return udata
                # Return first user if key matches
                if users:
                    return list(users.values())[0]
            elif isinstance(users, list) and users:
                return users[0]
        else:
            print(f"Failed to fetch user '{username}': Status {res.status_code} - {res.text}", file=sys.stderr)
        return None

    def search_users_directory(self, query: str, job_ids: list[int] = None) -> list:
        """
        Directory discovery search by name or skills.
        Queries GET /api/users/0.1/users/directory/
        """
        url = f"{BASE_URL}/users/0.1/users/directory/"
        params = {
            "query": query,
            "compact": "true",
            "reputation": "true",
        }
        if job_ids:
            params["jobs[]"] = job_ids

        res = requests.get(url, headers=self.headers, params=params, timeout=15)
        if res.status_code == 200:
            result = res.json().get("result", {})
            return result.get("users", [])
        return []


if __name__ == "__main__":
    client = FreelancerAPIClient()
    client.sanity_check()

    # Test fetching candidate 'ibrahimqq'
    print("\nTesting user lookup for username 'ibrahimqq'...")
    user_data = client.get_user_by_username("ibrahimqq")
    if user_data:
        print(f"Found User: {user_data.get('username')} (ID: {user_data.get('id')})")
        print("Keys returned:", list(user_data.keys()))
        location = user_data.get("location", {})
        print("Location details:", location)
        print("Jobs/Skills count:", len(user_data.get("jobs", [])))
        print("Reputation summary:", user_data.get("reputation", {}).get("entire_history", {}))
    else:
        print("User lookup failed!")

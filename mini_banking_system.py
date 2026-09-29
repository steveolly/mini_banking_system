import json
import threading
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


APP_DIRECTORY = Path(__file__).parent
WEB_DIRECTORY = APP_DIRECTORY / "web"
DATA_FILE = APP_DIRECTORY / "bank_data.json"


def money_amount(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite():
            raise InvalidOperation
        amount = amount.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise ValueError("Enter a valid amount.") from None
    if amount <= 0:
        raise ValueError("Amount must be at least ₦0.01.")
    return amount


class Account:
    def __init__(self, account_name, account_number, balance=0):
        self.account_name = account_name
        self.account_number = str(account_number)
        self.balance = Decimal(str(balance)).quantize(Decimal("0.01"))
        if not self.account_name.strip() or self.balance < 0:
            raise ValueError(
                "Account name and a non-negative balance are required.")

    def deposit(self, amount):
        amount = money_amount(amount)
        self.balance += amount
        return self.balance

    def withdraw(self, amount):
        amount = money_amount(amount)
        if amount > self.balance:
            raise ValueError("Insufficient funds.")
        self.balance -= amount
        return self.balance

    def check_balance(self):
        print(f"Your account balance is: ₦{self.balance:,.2f}")

    def display_info(self):
        print(f"Account name: {self.account_name}")
        print(f"Account number: {self.account_number}")


class Bank:
    def __init__(self):
        self.accounts = []

    def add_account(self, account):
        if self.find_account(account.account_number):
            raise ValueError("An account with that number already exists.")
        self.accounts.append(account)

    def find_account(self, account_number):
        return next(
            (account for account in self.accounts if account.account_number ==
             str(account_number)),
            None,
        )

    def show_accounts(self):
        return list(self.accounts)

    def delete_account(self, account_number):
        account = self.find_account(account_number)
        if not account:
            raise ValueError("Account not found.")
        if account.balance != 0:
            raise ValueError(
                "Withdraw or transfer the remaining balance before deleting this account.")
        self.accounts.remove(account)
        return account

    def transfer(self, sender_number, receiver_number, amount):
        sender = self.find_account(sender_number)
        receiver = self.find_account(receiver_number)
        if not sender or not receiver:
            raise ValueError("Choose two valid accounts to transfer between.")
        if sender is receiver:
            raise ValueError("Choose a different recipient account.")
        amount = money_amount(amount)
        if amount > sender.balance:
            raise ValueError("Insufficient funds.")
        sender.withdraw(amount)
        receiver.deposit(amount)


bank = Bank()
transactions = []
state_lock = threading.RLock()


def save_state():
    state = {
        "accounts": [
            {
                "name": account.account_name,
                "number": account.account_number,
                "balance": str(account.balance),
            }
            for account in bank.accounts
        ],
        "transactions": transactions,
    }
    temporary_file = DATA_FILE.with_suffix(".tmp")
    temporary_file.write_text(json.dumps(state, indent=2), encoding="utf-8")
    temporary_file.replace(DATA_FILE)


def load_state():
    if not DATA_FILE.exists():
        return
    state = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    for item in state.get("accounts", []):
        bank.add_account(
            Account(item["name"], item["number"], item["balance"]))
    transactions.extend(state.get("transactions", []))


def account_data(account):
    return {
        "name": account.account_name,
        "number": account.account_number,
        "balance": str(account.balance),
    }


def record_transaction(kind, amount, account, other_account=None):
    transaction = {
        "id": uuid.uuid4().hex,
        "type": kind,
        "amount": str(amount),
        "account": account_data(account),
        "otherAccount": account_data(other_account) if other_account else None,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    transactions.insert(0, transaction)
    del transactions[100:]
    return transaction


class BankingRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 16_384:
            raise ValueError("Request is too large.")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            with state_lock:
                self._send_json({
                    "accounts": [account_data(account) for account in bank.accounts],
                    "transactions": transactions,
                })
            return

        static_files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/styles.css": ("styles.css", "text/css; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
        }
        file_info = static_files.get(path)
        if not file_info:
            self.send_error(404)
            return
        file_name, content_type = file_info
        body = (WEB_DIRECTORY / file_name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            payload = self._read_json()
            with state_lock:
                if self.path == "/api/accounts":
                    name = str(payload.get("name", "")).strip()
                    if not name or len(name) > 80:
                        raise ValueError(
                            "Enter an account name (up to 80 characters).")
                    numbers = [int(account.account_number)
                               for account in bank.accounts if account.account_number.isdigit()]
                    number = str(max(numbers, default=1000000000) + 1)
                    account = Account(name, number)
                    bank.add_account(account)
                    result = {"account": account_data(account)}
                elif self.path in ("/api/deposit", "/api/withdraw"):
                    account = bank.find_account(
                        payload.get("accountNumber", ""))
                    if not account:
                        raise ValueError("Account not found.")
                    amount = money_amount(payload.get("amount"))
                    if self.path == "/api/deposit":
                        account.deposit(amount)
                        transaction = record_transaction(
                            "deposit", amount, account)
                    else:
                        account.withdraw(amount)
                        transaction = record_transaction(
                            "withdrawal", amount, account)
                    result = {"transaction": transaction}
                elif self.path == "/api/transfer":
                    sender = bank.find_account(payload.get("fromAccount", ""))
                    receiver = bank.find_account(payload.get("toAccount", ""))
                    if not sender or not receiver:
                        raise ValueError("Choose two valid accounts.")
                    amount = money_amount(payload.get("amount"))
                    bank.transfer(sender.account_number,
                                  receiver.account_number, amount)
                    result = {"transaction": record_transaction(
                        "transfer", amount, sender, receiver)}
                else:
                    self._send_json({"error": "Endpoint not found."}, 404)
                    return
                save_state()
                self._send_json(result, 201)
        except (ValueError, InvalidOperation, json.JSONDecodeError) as error:
            self._send_json({"error": str(error)}, 400)
        except (OSError, KeyError, TypeError) as error:
            self._send_json(
                {"error": f"Could not process the request: {error}"}, 500)

    def do_DELETE(self):
        path_parts = urlparse(self.path).path.strip("/").split("/")
        if len(path_parts) != 3 or path_parts[:2] != ["api", "accounts"]:
            self._send_json({"error": "Endpoint not found."}, 404)
            return
        try:
            with state_lock:
                account = bank.delete_account(path_parts[2])
                save_state()
                self._send_json({"account": account_data(account)})
        except ValueError as error:
            status = 404 if str(error) == "Account not found." else 400
            self._send_json({"error": str(error)}, status)
        except OSError as error:
            self._send_json(
                {"error": f"Could not process the request: {error}"}, 500)

    def log_message(self, format_string, *args):
        print(f"{self.log_date_time_string()} {format_string % args}")


def run_server(host="127.0.0.1", port=8000):
    load_state()
    server = ThreadingHTTPServer((host, port), BankingRequestHandler)
    print(f"Mini Banking System is running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    run_server()

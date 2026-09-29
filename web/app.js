const palette = [
    { accent: "#6d8d51", tint: "#eff6e7" },
    { accent: "#bd765e", tint: "#fff0e9" },
    { accent: "#a08a43", tint: "#faf4df" },
    { accent: "#587f77", tint: "#e9f3f0" },
];

const state = { accounts: [], transactions: [], action: "deposit" };
let accountToDelete = null;
const moneyFormat = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
const dateFormat = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" });
const dateLongFormat = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

const element = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const formatMoney = (value) => moneyFormat.format(Number(value) || 0);
const icon = (name) => `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;

async function request(path, body, method = body ? "POST" : "GET") {
    const response = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Something went wrong. Try again.");
    return result;
}

function renderAccounts() {
    const total = state.accounts.reduce((sum, account) => sum + Number(account.balance), 0);
    element("total-balance").innerHTML = `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(Math.floor(total))}<span>.${(Math.round((total % 1) * 100) + 100).toString().slice(-2)}</span>`;
    element("account-total").textContent = state.accounts.length;
    element("transaction-total").textContent = state.transactions.length;
    element("nav-count").textContent = state.accounts.length;
    element("account-heading-count").textContent = state.accounts.length;
    element("mix-count").textContent = state.accounts.length;
    element("balance-caption").textContent = state.accounts.length
        ? `Across ${state.accounts.length} ${state.accounts.length === 1 ? "account" : "accounts"}, ready when you are`
        : "Your accounts, all in one place";

    const list = element("accounts-list");
    if (!state.accounts.length) {
        list.innerHTML = `<div class="empty-state"><span class="empty-illustration">${icon("wallet")}</span><div><strong>Your first account starts here</strong><p>Create an account to begin organizing your money.</p></div></div>`;
    } else {
        list.innerHTML = state.accounts.map((account, index) => {
            const colors = palette[index % palette.length];
            return `<article class="account-row" style="--account-accent:${colors.accent};--account-tint:${colors.tint}">
        <span class="account-icon">${icon("wallet")}</span>
        <div class="account-details"><strong>${escapeHtml(account.name)}</strong><span>Account ${escapeHtml(account.number)}</span></div>
        <div class="account-end"><strong class="account-balance">${formatMoney(account.balance)}</strong><button class="account-action" data-action="deposit" data-account="${escapeHtml(account.number)}" title="Add funds to ${escapeHtml(account.name)}" aria-label="Add funds to ${escapeHtml(account.name)}">${icon("plus")}</button><button class="account-action account-delete" data-delete-account="${escapeHtml(account.number)}" title="Delete ${escapeHtml(account.name)}" aria-label="Delete ${escapeHtml(account.name)}">${icon("trash")}</button></div>
      </article>`;
        }).join("");
    }
    renderMix(total);
    populateAccountSelects();
}

function renderMix(total) {
    const chart = element("donut-chart");
    const legend = element("mix-legend");
    const colors = ["#729350", "#e29a78", "#e4c55d", "#5e948b"];
    if (!state.accounts.length || total <= 0) {
        chart.style.background = "conic-gradient(#e8eee5 0deg 360deg)";
        legend.innerHTML = '<div class="mix-empty">Your account breakdown will show up here.</div>';
        return;
    }
    let current = 0;
    const segments = state.accounts.map((account, index) => {
        const share = Number(account.balance) / total * 360;
        const start = current;
        current += share;
        return `${colors[index % colors.length]} ${start}deg ${current}deg`;
    });
    chart.style.background = `conic-gradient(${segments.join(",")})`;
    const shownAccounts = state.accounts.slice(0, 4);
    legend.innerHTML = shownAccounts.map((account, index) => `<div class="mix-legend-row">
    <span class="legend-dot" style="--legend-color:${colors[index % colors.length]}"></span>
    <span title="${escapeHtml(account.name)}">${escapeHtml(account.name)}</span>
    <strong>${Math.round(Number(account.balance) / total * 100)}%</strong>
  </div>`).join("");
    if (state.accounts.length > shownAccounts.length) {
        legend.insertAdjacentHTML("beforeend", `<div class="mix-empty">+ ${state.accounts.length - shownAccounts.length} more accounts</div>`);
    }
}

function renderTransactions() {
    const query = element("activity-search").value.trim().toLowerCase();
    const filtered = state.transactions.filter((transaction) => {
        const otherName = transaction.otherAccount?.name || "";
        return `${transaction.type} ${transaction.account.name} ${otherName}`.toLowerCase().includes(query);
    });
    const list = element("activity-list");
    if (!filtered.length && state.transactions.length) {
        list.innerHTML = '<div class="mix-empty" style="padding:18px 13px">No activity matches that search.</div>';
        return;
    }
    list.innerHTML = filtered.slice(0, 8).map((transaction) => {
        const isDeposit = transaction.type === "deposit";
        const title = isDeposit ? "Funds added" : transaction.type === "withdrawal" ? "Withdrawal" : "Transfer sent";
        const detail = transaction.type === "transfer"
            ? `To ${escapeHtml(transaction.otherAccount?.name || "another account")}`
            : escapeHtml(transaction.account.name);
        const date = new Date(transaction.createdAt);
        const amount = `${isDeposit ? "+" : "−"}${formatMoney(transaction.amount)}`;
        return `<div class="transaction-row">
      <div class="transaction-main"><span class="transaction-icon ${transaction.type}">${icon(isDeposit ? "arrow-down-left" : transaction.type === "withdrawal" ? "arrow-up-right" : "arrows")}</span><div><strong>${title}</strong><small>${detail}</small></div></div>
      <span class="transaction-date">${Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date)}</span>
      <span class="transaction-amount ${isDeposit ? "" : "negative"}">${amount}</span>
    </div>`;
    }).join("");
}

function populateAccountSelects() {
    const accountSelect = element("money-account");
    const recipientSelect = element("money-recipient");
    const previousAccount = accountSelect.value;
    accountSelect.innerHTML = state.accounts.map((account) => `<option value="${escapeHtml(account.number)}">${escapeHtml(account.name)} · ${escapeHtml(account.number)}</option>`).join("");
    if (state.accounts.some((account) => account.number === previousAccount)) accountSelect.value = previousAccount;
    const recipientOptions = state.accounts.filter((account) => account.number !== accountSelect.value);
    recipientSelect.innerHTML = recipientOptions.map((account) => `<option value="${escapeHtml(account.number)}">${escapeHtml(account.name)} · ${escapeHtml(account.number)}</option>`).join("");
    const needsRecipient = state.action === "transfer";
    const selectedAccount = state.accounts.find((account) => account.number === accountSelect.value);
    const needsFullBalanceOption = state.action === "withdraw" || needsRecipient;
    element("recipient-field").hidden = !needsRecipient;
    element("available-balance").hidden = !needsFullBalanceOption || !selectedAccount;
    element("available-label").textContent = needsRecipient ? "Available to move" : "Available to withdraw";
    element("available-amount").textContent = formatMoney(selectedAccount?.balance || 0);
    element("use-full-balance").disabled = !selectedAccount || Number(selectedAccount.balance) <= 0;
    element("money-submit").disabled = !state.accounts.length || (needsRecipient && recipientOptions.length === 0);
}

function openMoneyDialog(action, accountNumber) {
    if (!state.accounts.length) {
        showToast("Create an account before moving money.", true);
        element("account-dialog").showModal();
        return;
    }
    state.action = action;
    const details = {
        deposit: { kicker: "ADD TO YOUR BALANCE", title: "Add funds", copy: "Choose where the money should go.", button: "Add funds" },
        withdraw: { kicker: "TAKE FROM YOUR BALANCE", title: "Make a withdrawal", copy: "Choose an account and enter an amount.", button: "Withdraw" },
        transfer: { kicker: "BETWEEN YOUR ACCOUNTS", title: "Move money", copy: "Choose where the money is coming from and going to.", button: "Review transfer" },
    }[action];
    element("money-kicker").textContent = details.kicker;
    element("money-title").textContent = details.title;
    element("money-copy").textContent = details.copy;
    element("money-submit").innerHTML = `${details.button} ${icon("arrow-up-right")}`;
    populateAccountSelects();
    if (accountNumber) {
        element("money-account").value = accountNumber;
        populateAccountSelects();
    }
    element("money-amount").value = "";
    element("money-dialog").showModal();
}

let toastTimer;
function showToast(message, isError = false) {
    const toast = element("toast");
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

async function refreshState() {
    const data = await request("/api/state");
    state.accounts = data.accounts;
    state.transactions = data.transactions;
    renderAccounts();
    renderTransactions();
}

document.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-open]");
    if (opener) element(opener.dataset.open).showModal();

    const deleteButton = event.target.closest("[data-delete-account]");
    if (deleteButton) {
        accountToDelete = state.accounts.find((account) => account.number === deleteButton.dataset.deleteAccount);
        if (accountToDelete) {
            element("delete-copy").textContent = `Delete ${accountToDelete.name} (account ${accountToDelete.number})? Only zero-balance accounts can be deleted. Existing activity will remain in your history.`;
            element("delete-dialog").showModal();
        }
    }

    const actionButton = event.target.closest("[data-action]");
    if (actionButton) openMoneyDialog(actionButton.dataset.action, actionButton.dataset.account);

    if (event.target.closest(".dialog-close, .dialog-cancel")) {
        event.target.closest("dialog")?.close();
    }
});

element("delete-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!accountToDelete) return;
    const submit = element("delete-submit");
    submit.disabled = true;
    try {
        await request(`/api/accounts/${encodeURIComponent(accountToDelete.number)}`, undefined, "DELETE");
        element("delete-dialog").close();
        accountToDelete = null;
        await refreshState();
        showToast("Account deleted. Its activity remains in your history.");
    } catch (error) {
        showToast(error.message, true);
    } finally {
        submit.disabled = false;
    }
});

element("account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        await request("/api/accounts", { name: element("account-name").value.trim() });
        form.reset();
        element("account-dialog").close();
        await refreshState();
        showToast("Your new account is ready.");
    } catch (error) {
        showToast(error.message, true);
    } finally {
        submit.disabled = false;
    }
});

element("money-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = element("money-submit");
    submit.disabled = true;
    const amount = element("money-amount").value;
    const accountNumber = element("money-account").value;
    const endpoint = state.action === "transfer" ? "/api/transfer" : `/api/${state.action}`;
    const body = state.action === "transfer"
        ? { fromAccount: accountNumber, toAccount: element("money-recipient").value, amount }
        : { accountNumber, amount };
    try {
        await request(endpoint, body);
        element("money-dialog").close();
        form.reset();
        await refreshState();
        showToast(state.action === "transfer" ? "Transfer complete." : state.action === "deposit" ? "Funds added successfully." : "Withdrawal complete.");
    } catch (error) {
        showToast(error.message, true);
    } finally {
        populateAccountSelects();
    }
});

element("money-account").addEventListener("change", populateAccountSelects);
element("use-full-balance").addEventListener("click", () => {
    const selectedAccount = state.accounts.find((account) => account.number === element("money-account").value);
    if (selectedAccount && Number(selectedAccount.balance) > 0) {
        element("money-amount").value = selectedAccount.balance;
        element("money-amount").focus();
    }
});
element("activity-search").addEventListener("input", renderTransactions);
element("today-date").textContent = dateLongFormat.format(new Date());
element("menu-button").addEventListener("click", () => {
    const isOpen = element("sidebar").classList.toggle("is-open");
    element("scrim").classList.toggle("is-visible", isOpen);
    element("menu-button").setAttribute("aria-expanded", String(isOpen));
});
element("scrim").addEventListener("click", () => {
    element("sidebar").classList.remove("is-open");
    element("scrim").classList.remove("is-visible");
    element("menu-button").setAttribute("aria-expanded", "false");
});

refreshState().catch((error) => {
    showToast(`Could not connect to the banking server: ${error.message}`, true);
});
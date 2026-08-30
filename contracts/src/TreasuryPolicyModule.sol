// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title TreasuryPolicyModule
/// @notice Stage 1-4: recipient whitelist, per-tx limit, rolling 24h cumulative
///         limit, session expiry, duplicate-payment protection, and an
///         on-chain approval gate for large payments. The AI session key
///         can only call aiTransfer(). It can NEVER change policy or
///         approve its own payments — only `root` (the CFO) can.
contract TreasuryPolicyModule {
    address public immutable root;
    address public aiSession;

    mapping(address => bool) public allowedRecipient;
    address public allowedToken;
    uint256 public perTxLimit;
    uint256 public dailyLimit;
    uint256 public approvalThreshold;   // amounts strictly above this need approveInvoice() first
    uint256 public sessionExpiry;
    uint256 public policyVersion;

    /// @dev Rolling-24h daily limit. Every successful transfer is appended
    ///      here; `_spentInLast24h` sums only records younger than 24h, so
    ///      spend does NOT reset at a fixed UTC midnight (that let an
    ///      attacker double-spend across the calendar-day boundary).
    struct TransferRecord {
        uint256 timestamp;
        uint256 amount;
    }
    TransferRecord[] public transferHistory;

    mapping(bytes32 => bool) public paidInvoice;       // invoiceHash => already paid
    /// @dev key = keccak256(abi.encode(token, recipient, amount, invoiceHash)).
    ///      Root approves the FULL payment content, not just the invoice id,
    ///      so the AI can't reuse an approved invoiceHash with a different
    ///      recipient or amount.
    mapping(bytes32 => bool) public approvedInvoice;

    event RecipientAllowed(address indexed recipient, bool allowed);
    event PerTxLimitUpdated(uint256 newLimit);
    event DailyLimitUpdated(uint256 newLimit);
    event ApprovalThresholdUpdated(uint256 newThreshold);
    event SessionExpiryUpdated(uint256 newExpiry);
    event AiSessionUpdated(address indexed newAiSession);
    event InvoiceApproved(bytes32 indexed approvalHash, bytes32 indexed invoiceHash);
    event Transferred(address indexed token, address indexed to, uint256 amount, bytes32 indexed invoiceHash);

    error NotRoot();
    error NotAiSession();
    error RecipientNotAllowed(address recipient);
    error TokenNotAllowed(address token);
    error PerTxLimitExceeded(uint256 amount, uint256 limit);
    error DailyLimitExceeded(uint256 attempted, uint256 limit);
    error SessionExpired(uint256 nowTs, uint256 expiry);
    error DuplicatePayment(bytes32 invoiceHash);
    error ApprovalRequired(bytes32 invoiceHash);

    modifier onlyRoot() {
        if (msg.sender != root) revert NotRoot();
        _;
    }
    modifier onlyAiSession() {
        if (msg.sender != aiSession) revert NotAiSession();
        _;
    }

    constructor(
        address _root,
        address _aiSession,
        address _allowedToken,
        uint256 _perTxLimit,
        uint256 _dailyLimit,
        uint256 _approvalThreshold,
        uint256 _sessionExpiry
    ) {
        root = _root;
        aiSession = _aiSession;
        allowedToken = _allowedToken;
        perTxLimit = _perTxLimit;
        dailyLimit = _dailyLimit;
        approvalThreshold = _approvalThreshold;
        sessionExpiry = _sessionExpiry;
        policyVersion = 1;
    }

    // ---- Root-only policy controls. The AI can NEVER call these. ----

    function setAllowedRecipient(address recipient, bool ok) external onlyRoot {
        allowedRecipient[recipient] = ok;
        policyVersion++;
        emit RecipientAllowed(recipient, ok);
    }

    function setPerTxLimit(uint256 newLimit) external onlyRoot {
        perTxLimit = newLimit;
        policyVersion++;
        emit PerTxLimitUpdated(newLimit);
    }

    function setDailyLimit(uint256 newLimit) external onlyRoot {
        dailyLimit = newLimit;
        policyVersion++;
        emit DailyLimitUpdated(newLimit);
    }

    function setApprovalThreshold(uint256 newThreshold) external onlyRoot {
        approvalThreshold = newThreshold;
        policyVersion++;
        emit ApprovalThresholdUpdated(newThreshold);
    }

    function setSessionExpiry(uint256 newExpiry) external onlyRoot {
        sessionExpiry = newExpiry;
        policyVersion++;
        emit SessionExpiryUpdated(newExpiry);
    }

    function setAiSession(address newAiSession) external onlyRoot {
        aiSession = newAiSession;
        emit AiSessionUpdated(newAiSession);
    }

    /// @notice Root (CFO) signs off on one specific, fully-specified payment
    ///         ahead of time: which token, which recipient, exactly how much,
    ///         under which invoice id. Required before aiTransfer() will move
    ///         an amount above approvalThreshold. The AI can never call this
    ///         itself, and cannot reuse the approval for a different
    ///         recipient or amount under the same invoiceHash.
    function approveInvoice(address token, address recipient, uint256 amount, bytes32 invoiceHash)
        external
        onlyRoot
    {
        bytes32 approvalHash = keccak256(abi.encode(token, recipient, amount, invoiceHash));
        approvedInvoice[approvalHash] = true;
        emit InvoiceApproved(approvalHash, invoiceHash);
    }

    /// @dev Sums transferHistory entries newer than (now - 24h). Entries are
    ///      appended in increasing timestamp order, so we can walk backwards
    ///      from the end and stop at the first entry that's aged out.
    function _spentInLast24h() internal view returns (uint256) {
        uint256 windowStart = block.timestamp > 1 days ? block.timestamp - 1 days : 0;
        uint256 sum = 0;
        uint256 len = transferHistory.length;
        for (uint256 i = len; i > 0; i--) {
            TransferRecord storage rec = transferHistory[i - 1];
            if (rec.timestamp < windowStart) break;
            sum += rec.amount;
        }
        return sum;
    }

    // ---- The ONLY function the AI session key is allowed to call. ----
    function aiTransfer(address token, address to, uint256 amount, bytes32 invoiceHash)
        external
        onlyAiSession
        returns (bool)
    {
        if (token != allowedToken) revert TokenNotAllowed(token);
        if (!allowedRecipient[to]) revert RecipientNotAllowed(to);
        if (amount > perTxLimit) revert PerTxLimitExceeded(amount, perTxLimit);
        if (block.timestamp >= sessionExpiry) revert SessionExpired(block.timestamp, sessionExpiry);
        if (paidInvoice[invoiceHash]) revert DuplicatePayment(invoiceHash);

        if (amount > approvalThreshold) {
            bytes32 approvalHash = keccak256(abi.encode(token, to, amount, invoiceHash));
            if (!approvedInvoice[approvalHash]) revert ApprovalRequired(invoiceHash);
            approvedInvoice[approvalHash] = false; // one-time use, consumed on success
        }

        uint256 spentRecently = _spentInLast24h();
        uint256 attempted = spentRecently + amount;
        if (attempted > dailyLimit) revert DailyLimitExceeded(attempted, dailyLimit);

        transferHistory.push(TransferRecord({timestamp: block.timestamp, amount: amount}));
        paidInvoice[invoiceHash] = true;

        bool ok = IERC20(token).transfer(to, amount);
        require(ok, "ERC20 transfer failed");
        emit Transferred(token, to, amount, invoiceHash);
        return true;
    }

    // ---- Read-only, for M2's Blast Radius calculation. ----
    function readPermission()
        external
        view
        returns (
            address token,
            uint256 perTx,
            uint256 daily,
            uint256 remainingToday,
            uint256 expiry,
            uint256 policyVer
        )
    {
        uint256 spentRecently = _spentInLast24h();
        uint256 remaining = dailyLimit > spentRecently ? dailyLimit - spentRecently : 0;
        return (allowedToken, perTxLimit, dailyLimit, remaining, sessionExpiry, policyVersion);
    }
}

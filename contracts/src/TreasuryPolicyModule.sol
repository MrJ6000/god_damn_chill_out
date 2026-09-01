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

    /// @dev Rolling-24h daily limit, stored as fixed-size hourly buckets.
    ///      Spend accumulates into bucketSpent[timestamp / BUCKET_DURATION];
    ///      the window is the current bucket plus the previous 24
    ///      (BUCKET_COUNT - 1).
    ///      Spend still does NOT reset at a fixed UTC midnight (that let an
    ///      attacker double-spend across the calendar-day boundary), but
    ///      unlike an append-only history array the read cost is bounded at
    ///      exactly BUCKET_COUNT slots, so a compromised session key cannot
    ///      spam tiny transfers to make every later call unaffordably
    ///      expensive (gas DoS).
    ///      BUCKET_COUNT is 25, not 24, on purpose: with 24 buckets a spend
    ///      landing at the very end of a bucket would be released again after
    ///      only ~23h, which is less than the advertised 24h cap. With 25 the
    ///      effective window is 24h-25h, i.e. never shorter than promised.
    ///      Trade-off: the window can hold spend for up to an extra hour,
    ///      which is the conservative direction for a spending limit.
    uint256 public constant BUCKET_DURATION = 1 hours;
    uint256 public constant BUCKET_COUNT = 25;
    mapping(uint256 => uint256) public bucketSpent;

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

    /// @dev Sums the current hourly bucket plus the previous BUCKET_COUNT - 1.
    ///      Cost is fixed no matter how many transfers have ever occurred.
    function _spentInLast24h() internal view returns (uint256) {
        uint256 currentBucket = block.timestamp / BUCKET_DURATION;
        uint256 sum = 0;
        for (uint256 i = 0; i < BUCKET_COUNT; i++) {
            if (currentBucket < i) break;
            sum += bucketSpent[currentBucket - i];
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

        bucketSpent[block.timestamp / BUCKET_DURATION] += amount;
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

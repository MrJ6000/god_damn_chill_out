// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title TreasuryPolicyModule
/// @notice Stage 1+2: recipient whitelist + per-tx limit + 24h cumulative
///         limit + session expiry. The AI session key can only call
///         aiTransfer(). It can NEVER change policy — only `root` (the CFO) can.
contract TreasuryPolicyModule {
    address public immutable root;
    address public aiSession;

    mapping(address => bool) public allowedRecipient;
    address public allowedToken;
    uint256 public perTxLimit;
    uint256 public dailyLimit;
    uint256 public sessionExpiry;
    uint256 public policyVersion;

    // day index (block.timestamp / 1 days) => amount already spent that day
    mapping(uint256 => uint256) public spentOnDay;

    event RecipientAllowed(address indexed recipient, bool allowed);
    event PerTxLimitUpdated(uint256 newLimit);
    event DailyLimitUpdated(uint256 newLimit);
    event SessionExpiryUpdated(uint256 newExpiry);
    event AiSessionUpdated(address indexed newAiSession);
    event Transferred(address indexed token, address indexed to, uint256 amount, bytes32 indexed invoiceHash);

    error NotRoot();
    error NotAiSession();
    error RecipientNotAllowed(address recipient);
    error TokenNotAllowed(address token);
    error PerTxLimitExceeded(uint256 amount, uint256 limit);
    error DailyLimitExceeded(uint256 attempted, uint256 limit);
    error SessionExpired(uint256 nowTs, uint256 expiry);

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
        uint256 _sessionExpiry
    ) {
        root = _root;
        aiSession = _aiSession;
        allowedToken = _allowedToken;
        perTxLimit = _perTxLimit;
        dailyLimit = _dailyLimit;
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

    function setSessionExpiry(uint256 newExpiry) external onlyRoot {
        sessionExpiry = newExpiry;
        policyVersion++;
        emit SessionExpiryUpdated(newExpiry);
    }

    function setAiSession(address newAiSession) external onlyRoot {
        aiSession = newAiSession;
        emit AiSessionUpdated(newAiSession);
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

        uint256 today = block.timestamp / 1 days;
        uint256 attempted = spentOnDay[today] + amount;
        if (attempted > dailyLimit) revert DailyLimitExceeded(attempted, dailyLimit);
        spentOnDay[today] = attempted;

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
        uint256 today = block.timestamp / 1 days;
        uint256 spentToday = spentOnDay[today];
        uint256 remaining = dailyLimit > spentToday ? dailyLimit - spentToday : 0;
        return (allowedToken, perTxLimit, dailyLimit, remaining, sessionExpiry, policyVersion);
    }
}

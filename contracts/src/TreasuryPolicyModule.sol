// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title TreasuryPolicyModule
/// @notice Stage 1: recipient whitelist + per-tx limit + session expiry.
///         The AI session key can only call aiTransfer(). It can NEVER
///         change policy — only `root` (the CFO) can.
contract TreasuryPolicyModule {
    address public immutable root;   // CFO — highest authority
    address public aiSession;        // AI's scoped session key address

    mapping(address => bool) public allowedRecipient;
    address public allowedToken;     // USDC address on Base Sepolia
    uint256 public perTxLimit;       // smallest unit (USDC has 6 decimals)
    uint256 public sessionExpiry;    // unix timestamp
    uint256 public policyVersion;

    event RecipientAllowed(address indexed recipient, bool allowed);
    event PerTxLimitUpdated(uint256 newLimit);
    event SessionExpiryUpdated(uint256 newExpiry);
    event AiSessionUpdated(address indexed newAiSession);
    event Transferred(address indexed token, address indexed to, uint256 amount, bytes32 indexed invoiceHash);

    error NotRoot();
    error NotAiSession();
    error RecipientNotAllowed(address recipient);
    error TokenNotAllowed(address token);
    error PerTxLimitExceeded(uint256 amount, uint256 limit);
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
        uint256 _sessionExpiry
    ) {
        root = _root;
        aiSession = _aiSession;
        allowedToken = _allowedToken;
        perTxLimit = _perTxLimit;
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
            uint256 expiry,
            uint256 policyVer
        )
    {
        return (allowedToken, perTxLimit, sessionExpiry, policyVersion);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Test-only stand-ins for the Ritual system contracts and precompiles.
 *
 * Each mock's runtime code is etched onto the canonical address with `vm.etch`, so
 * RitualPredict calls the same hardcoded addresses it would on Ritual Chain and never
 * learns it is being tested. Etching copies runtime code but NOT storage, so every
 * mock starts zeroed and the test configures it through the setters below.
 *
 * Nothing in this file is deployed to a real network.
 */

// ─────────────────────────────── Scheduler ───────────────────────────────

/**
 * Stand-in for the Scheduler at 0x56e7…D58B.
 *
 * Records what was booked so tests can assert on gas, blocks, retries and payer, and
 * can replay an execution with `fire()`, which reproduces the one piece of real
 * Scheduler behaviour that is easy to get wrong: bytes 4 to 35 of the stored calldata are
 * overwritten with the actual executionIndex before the callback runs.
 */
contract MockScheduler {
    struct Call {
        address target;
        bytes data;
        uint32 gas;
        uint32 startBlock;
        uint32 numCalls;
        uint32 frequency;
        uint32 ttl;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        uint256 value;
        address payer;
        uint8 state; // 0 SCHEDULED, 2 COMPLETED, 3 CANCELLED
    }

    uint256 public nextCallId;
    mapping(uint256 => Call) private _calls;
    mapping(address => address) public approvedBy;

    /// Set true to make schedule() revert, standing in for a Scheduler rejection.
    bool public scheduleReverts;

    uint256 public cancelCount;
    uint256 public lastCancelledId;

    function setScheduleReverts(bool value) external {
        scheduleReverts = value;
    }

    function approveScheduler(address schedulerContract) external {
        approvedBy[msg.sender] = schedulerContract;
    }

    function schedule(
        bytes calldata data,
        uint32 gas,
        uint32 startBlock,
        uint32 numCalls,
        uint32 frequency,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256 value,
        address payer
    ) external returns (uint256 callId) {
        require(!scheduleReverts, "scheduler: rejected");
        // Mirror the real contract's lifespan guard.
        require(
            uint256(frequency) * uint256(numCalls) <= 10_000,
            "ScheduleLifespanExceeded"
        );

        callId = ++nextCallId;
        _calls[callId] = Call({
            target: msg.sender,
            data: data,
            gas: gas,
            startBlock: startBlock,
            numCalls: numCalls,
            frequency: frequency,
            ttl: ttl,
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            value: value,
            payer: payer,
            state: 0
        });
    }

    function cancel(uint256 callId) external {
        require(_calls[callId].target == msg.sender, "scheduler: not owner");
        _calls[callId].state = 3;
        cancelCount++;
        lastCancelledId = callId;
    }

    function getCallState(uint256 callId) external view returns (uint8) {
        return _calls[callId].state;
    }

    function getCall(uint256 callId) external view returns (Call memory) {
        return _calls[callId];
    }

    /**
     * Replay one execution exactly as the chain would: the stored calldata has bytes
     * 4 to 35 replaced with `executionIndex`, and the call arrives from this address,
     * which, once etched, IS the canonical Scheduler address.
     */
    function fire(
        uint256 callId,
        uint256 executionIndex
    ) external returns (bool ok, bytes memory ret) {
        Call storage c = _calls[callId];
        require(c.target != address(0), "scheduler: unknown call");
        require(c.state == 0, "scheduler: not live");

        bytes memory data = c.data;
        require(data.length >= 36, "scheduler: calldata too short");

        // Overwrite the 32 bytes following the 4-byte selector.
        assembly {
            mstore(add(data, 36), executionIndex)
        }

        (ok, ret) = c.target.call{gas: c.gas}(data);
    }
}

// ───────────────────────────── RitualWallet ──────────────────────────────

/// Stand-in for the prepaid fee escrow at 0x532F…3948.
contract MockRitualWallet {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public lockUntil;

    function deposit(uint256 lockDuration) external payable {
        balanceOf[msg.sender] += msg.value;
        lockUntil[msg.sender] = block.number + lockDuration;
    }
}

// ───────────────────────── TEEServiceRegistry ────────────────────────────

/// Stand-in for the attested-executor registry at 0x9644…f47F.
contract MockTEERegistry {
    address[] private _executors;
    bool public registryReverts;

    function setExecutors(address[] calldata executors) external {
        delete _executors;
        for (uint256 i = 0; i < executors.length; i++) {
            _executors.push(executors[i]);
        }
    }

    function setRegistryReverts(bool value) external {
        registryReverts = value;
    }

    function executorCount() external view returns (uint256) {
        return _executors.length;
    }

    function pickServiceByCapability(
        uint8 capability,
        bool,
        uint256 seed,
        uint256
    ) external view returns (address teeAddress, bool found) {
        require(!registryReverts, "registry: down");
        // Only HTTP_CALL (0) is populated in these tests.
        if (capability != 0 || _executors.length == 0)
            return (address(0), false);
        return (_executors[seed % _executors.length], true);
    }
}

// ──────────────────────────── HTTP precompile ────────────────────────────

/**
 * Stand-in for the HTTP call precompile at 0x0801.
 *
 * The real precompile takes a raw `abi.encode`d 13-field request with no selector, so
 * the first four calldata bytes are zero and Solidity's dispatcher falls through to
 * `fallback`, leaving the named setters below reachable by their own selectors.
 *
 * Returns the async envelope `abi.encode(bytes simmedInput, bytes actualOutput)`.
 */
contract MockHttpPrecompile {
    enum Mode {
        Ok, // a settled response built from the fields below
        Revert, // the precompile call itself fails
        Unsettled, // envelope present, actualOutput empty (simulation phase)
        Garbage // bytes that cannot be decoded as the envelope at all
    }

    Mode public mode;
    uint16 public status;
    bytes public body;
    string public errorMessage;

    /// Last raw request seen, so tests can decode and assert on the 13 fields.
    bytes public lastRequest;
    uint256 public callCount;

    function setResponse(
        uint16 status_,
        bytes calldata body_,
        string calldata errorMessage_
    ) external {
        mode = Mode.Ok;
        status = status_;
        body = body_;
        errorMessage = errorMessage_;
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    /// The 13 fields of HTTPCallRequest, in precompile order.
    struct HttpRequest {
        address executor;
        bytes[] encryptedSecrets;
        uint256 ttl;
        bytes[] secretSignatures;
        bytes userPublicKey;
        string url;
        uint8 method;
        string[] headerKeys;
        string[] headerValues;
        bytes body;
        uint256 dkmsKeyIndex;
        uint8 dkmsKeyFormat;
        bool piiEnabled;
    }

    /**
     * Decoded as one struct rather than 13 locals, because the flat tuple form is
     * stack-too-deep. `abi.encode(a, b, …)` writes the tuple with no leading head, but
     * decoding into a dynamic struct expects one, so the 0x20 offset is prepended here.
     */
    function decodeLastRequest()
        external
        view
        returns (HttpRequest memory request)
    {
        request = abi.decode(
            bytes.concat(abi.encode(uint256(0x20)), lastRequest),
            (HttpRequest)
        );
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        lastRequest = input;
        callCount++;

        if (mode == Mode.Revert) revert("http: executor unavailable");
        if (mode == Mode.Garbage) return hex"deadbeef";
        if (mode == Mode.Unsettled) return abi.encode(input, bytes(""));

        bytes memory actualOutput = abi.encode(
            status,
            new string[](0),
            new string[](0),
            body,
            errorMessage
        );
        return abi.encode(input, actualOutput);
    }
}

// ───────────────────────────── jq precompile ─────────────────────────────

/**
 * Stand-in for the jq precompile at 0x0803.
 *
 * Rather than replay a canned number, this really does read the JSON: it looks up the
 * top-level key named by the query (".price" → "price") and parses the digits that
 * follow. That keeps the "could not parse oracle body" branch honest, because a test feeds it
 * genuinely malformed JSON and gets a genuine miss, not a flag someone flipped.
 *
 * Scope is deliberately small: top-level keys, unsigned integers, digits truncated at
 * the first non-digit (so `4123.55` reads as `4123`, matching outputType uint256).
 */
contract MockJqPrecompile {
    /// Set true to reproduce a wrong outputType: ok = true, zero-length output.
    bool public returnEmpty;

    function setReturnEmpty(bool value) external {
        returnEmpty = value;
    }

    /**
     * jq is synchronous and RitualPredict reaches it with `staticcall`, so this
     * fallback must not touch storage. A single SSTORE here (a call counter, say)
     * makes every real jq read revert and quietly turns every market Invalid.
     */
    fallback(bytes calldata input) external returns (bytes memory) {
        if (returnEmpty) return "";

        (string memory query, string memory json, ) = abi.decode(
            input,
            (string, string, uint8)
        );

        (bool ok, uint256 value) = _extract(bytes(query), bytes(json));
        if (!ok) return "";
        return abi.encode(value);
    }

    /// ".price" → look up "price" and read the number after its colon.
    function _extract(
        bytes memory query,
        bytes memory json
    ) private pure returns (bool, uint256) {
        if (query.length < 2 || query[0] != ".") return (false, 0);

        bytes memory key = new bytes(query.length - 1);
        for (uint256 i = 1; i < query.length; i++) key[i - 1] = query[i];

        int256 at = _indexOf(json, key);
        if (at < 0) return (false, 0);

        // Walk past the key, its closing quote and the colon.
        uint256 i2 = uint256(at) + key.length;
        bool sawColon = false;
        while (i2 < json.length) {
            bytes1 c = json[i2];
            if (c == ":") {
                sawColon = true;
                i2++;
                break;
            }
            if (c != '"' && c != " ") return (false, 0);
            i2++;
        }
        if (!sawColon) return (false, 0);

        while (i2 < json.length && json[i2] == " ") i2++;

        uint256 value;
        uint256 digits;
        while (i2 < json.length) {
            bytes1 c = json[i2];
            if (c < "0" || c > "9") break;
            value = value * 10 + (uint8(c) - 48);
            digits++;
            i2++;
        }
        if (digits == 0) return (false, 0);
        return (true, value);
    }

    function _indexOf(
        bytes memory haystack,
        bytes memory needle
    ) private pure returns (int256) {
        if (needle.length == 0 || needle.length > haystack.length) return -1;
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return int256(i);
        }
        return -1;
    }
}

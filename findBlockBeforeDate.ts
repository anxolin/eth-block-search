/**
 * Binary-search the chain to find the latest block strictly before a given date/time.
 * Usage:
 *   ts-node findBlockBeforeDate.ts <RPC_URL> <DATE>
 * Examples:
 *   ts-node findBlockBeforeDate.ts https://mainnet.infura.io/v3/KEY "2024-12-31T23:59:59Z"
 *   ts-node findBlockBeforeDate.ts https://eth.llamarpc.com 1704067199
 *   ts-node findBlockBeforeDate.ts https://eth.llamarpc.com 1704067199000
 */

type RpcBlock = {
  number: string; // hex string
  timestamp: string; // hex string
  hash: string;
  parentHash: string;
};

let rpcId = 1;

async function rpc<T>(
  url: string,
  method: string,
  params: any[] = []
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RPC HTTP ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  }
  return json.result as T;
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

/** Accepts ISO 8601 string, unix seconds, or unix milliseconds. Returns seconds since epoch. */
function parseTargetToUnixSeconds(input: string): number {
  // If purely numeric, interpret as seconds (<= 10 digits) or milliseconds (> 10 digits)
  if (/^-?\d+$/.test(input.trim())) {
    const n = Number(input);
    if (!Number.isFinite(n)) throw new Error("Invalid numeric date.");
    return n > 1e10 ? Math.floor(n / 1000) : n;
  }
  // Otherwise treat as ISO/string date
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) throw new Error(`Unrecognized date format: ${input}`);
  return Math.floor(ms / 1000);
}

async function getLatestBlockNumber(url: string): Promise<bigint> {
  const hexNum = await rpc<string>(url, "eth_blockNumber");
  return hexToBigInt(hexNum);
}

async function getBlockByNumber(url: string, n: bigint): Promise<RpcBlock> {
  const hex = "0x" + n.toString(16);
  const block = await rpc<RpcBlock>(url, "eth_getBlockByNumber", [hex, false]);
  if (!block) throw new Error(`Block ${hex} not found`);
  return block;
}

async function findBlockBeforeDate(url: string, targetUnixSec: number) {
  const latestNum = await getLatestBlockNumber(url);
  const latest = await getBlockByNumber(url, latestNum);
  const latestTs = Number(hexToBigInt(latest.timestamp));

  // Fast paths
  if (targetUnixSec <= 0) {
    return null; // nothing strictly before 1970-01-01
  }
  if (targetUnixSec > latestTs) {
    // The "latest block before date" is simply the latest block
    return {
      number: Number(latestNum),
      hash: latest.hash,
      timestamp: latestTs,
    };
  }

  // Standard binary search over [0, latestNum]
  let lo = 0n;
  let hi = latestNum;
  let candidate: { n: bigint; ts: number; hash: string } | null = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1n;
    const b = await getBlockByNumber(url, mid);
    const ts = Number(hexToBigInt(b.timestamp));

    if (ts < targetUnixSec) {
      candidate = { n: mid, ts, hash: b.hash };
      lo = mid + 1n;
    } else {
      hi = mid - 1n;
    }
  }

  if (!candidate) {
    // Even block 0 is >= target
    return null;
  }

  return {
    number: Number(candidate.n),
    hash: candidate.hash,
    timestamp: candidate.ts,
  };
}

async function main() {
  const [, , rpcUrl, dateInput] = process.argv;
  if (!rpcUrl || !dateInput) {
    console.error(
      "Usage: ts-node findBlockBeforeDate.ts <RPC_URL> <DATE>\n" +
        "DATE can be ISO (e.g. 2024-12-31T23:59:59Z), unix seconds, or unix milliseconds."
    );
    process.exit(1);
  }

  const targetSec = parseTargetToUnixSeconds(dateInput);

  const result = await findBlockBeforeDate(rpcUrl, targetSec);

  if (!result) {
    console.log("No block exists strictly before the given date.");
    return;
  }

  const iso = new Date(result.timestamp * 1000).toISOString();
  console.log(
    JSON.stringify(
      {
        blockNumber: result.number,
        blockHash: result.hash,
        blockTimestamp: result.timestamp,
        blockTimestampISO: iso,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

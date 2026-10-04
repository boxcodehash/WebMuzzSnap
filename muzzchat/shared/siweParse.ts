export type ParsedSiwe = {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
};

const SIWE_RE =
  /^(.+) wants you to sign in with your Ethereum account:\n(0x[a-fA-F0-9]{40})\n\n([\s\S]*?)\n\nURI: (\S+)\nVersion: ([^\n]+)\nChain ID: (\d+)\nNonce: ([A-Za-z0-9]+)\nIssued At: ([^\n]+)\s*$/;

/** Parses the EIP-4361 message produced by the MuzzChat client. */
export function parseSiweMessage(message: string): ParsedSiwe {
  const match = SIWE_RE.exec(message.trim());
  if (!match) throw new Error("SIWE_PARSE");
  return {
    domain: match[1]!,
    address: match[2]!,
    statement: match[3]!,
    uri: match[4]!,
    version: match[5]!,
    chainId: Number(match[6]),
    nonce: match[7]!,
    issuedAt: match[8]!,
  };
}

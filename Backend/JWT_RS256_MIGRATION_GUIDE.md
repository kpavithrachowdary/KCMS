# 🔐 JWT RS256 Migration Guide

**Workplan Reference:** Line 622 - JWT signing (RS256)  
**Migration Type:** HS256 → RS256 (Symmetric to Asymmetric)  
**Status:** Production Ready ✅

---

## 📋 **Overview**

This guide covers the complete migration from HS256 (symmetric) to RS256 (asymmetric) JWT signing for enhanced security and better distributed system support.

### **Why RS256?**

| Feature | HS256 (Current) | RS256 (New) | Winner |
|---------|-----------------|-------------|--------|
| **Security** | Symmetric key | Asymmetric key pair | ✅ RS256 |
| **Key Distribution** | Shared secret | Public key can be shared | ✅ RS256 |
| **Microservices** | Must share secret | Only need public key | ✅ RS256 |
| **Industry Standard** | Basic | OAuth 2.0 / OIDC standard | ✅ RS256 |
| **Key Rotation** | Requires coordination | Independent rotation | ✅ RS256 |
| **Token Verification** | Anyone with secret | Only private key signs | ✅ RS256 |

---

## 🎯 **Migration Strategy**

We use **zero-downtime migration** with backward compatibility:

1. **Generate RSA keys** (one-time)
2. **Enable migration mode** (supports both HS256 & RS256)
3. **Deploy** (new tokens use RS256, old HS256 tokens still work)
4. **Wait for token expiry** (7 days = refresh token TTL)
5. **Disable HS256** (all tokens now RS256)

---

## ⚙️ **Step-by-Step Migration**

### **Phase 1: Preparation (10 minutes)**

#### 1.1 Generate RSA Key Pair

```bash
# Run the key generation script
npm run generate:rsa-keys
```

**Output:**
```
🔐 Generating RSA Key Pair for JWT RS256...
✅ Created keys directory
✅ RSA Key Pair Generated Successfully!

📝 Key Details:
   Key Size: 2048 bits
   Private Key: /path/to/Backend/keys/jwt-private.pem
   Public Key: /path/to/Backend/keys/jwt-public.pem
```

#### 1.2 Verify Key Files

```bash
ls -la keys/
# Should show:
# -rw-------  1 user  group  1679 Oct 17 15:00 jwt-private.pem  (permissions: 600)
# -rw-r--r--  1 user  group   451 Oct 17 15:00 jwt-public.pem   (permissions: 644)
# -rw-r--r--  1 user  group   123 Oct 17 15:00 .gitignore
# -rw-r--r--  1 user  group   456 Oct 17 15:00 README.md
```

#### 1.3 Update Environment Variables

Add to `.env`:

```bash
# JWT RS256 Configuration
JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_PATH=./keys/jwt-private.pem
JWT_PUBLIC_KEY_PATH=./keys/jwt-public.pem

# Enable Migration Mode (temporary)
JWT_MIGRATION_MODE=true

# Keep legacy secret during migration
JWT_SECRET=your-current-secret-here

# Token Expiry (existing)
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
```

---

### **Phase 2: Deployment (30 minutes)**

#### 2.1 Test Configuration Locally

```bash
# Start server
npm run dev

# Check JWT configuration
curl http://localhost:5000/api/auth/jwt-info
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "algorithm": "RS256",
    "issuer": "kmit-clubs-hub",
    "audience": "kmit-students",
    "accessTokenExpiry": "15m",
    "refreshTokenExpiry": "7d",
    "isAsymmetric": true,
    "migrationMode": true,
    "supportsHS256Fallback": true,
    "keySource": "files"
  }
}
```

#### 2.2 Deploy to Staging

```bash
# Deploy with new configuration
git add .env.rs256.example JWT_RS256_MIGRATION_GUIDE.md
git commit -m "feat: Add JWT RS256 support with migration mode"
git push origin develop

# Deploy to staging
# Follow your deployment process
```

#### 2.3 Verify Staging

```bash
# Test new login (gets RS256 token)
curl -X POST https://staging-api.kmit.edu/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "test@kmit.edu", "password": "Test@1234"}'

# Decode token to verify algorithm
# Copy accessToken from response
jwt decode <access-token>
# Should show: "alg": "RS256"

# Test old token (HS256) still works
# Use an existing valid token from before migration
curl https://staging-api.kmit.edu/api/users/me \
  -H "Authorization: Bearer <old-hs256-token>"
# Should work! (migration mode active)
```

#### 2.4 Monitor Logs

```bash
# Watch for migration mode messages
tail -f logs/app.log | grep "Migration mode"

# Expected logs:
# ✅ JWT RSA keys loaded from files
# 🔄 Migration mode: Attempting HS256 verification for legacy token
```

---

### **Phase 3: Migration Period (7 days)**

During this phase:
- ✅ New logins get RS256 tokens
- ✅ Old HS256 tokens continue to work
- ✅ Users naturally migrate as they refresh tokens
- ✅ No user impact

#### 3.1 Monitor Token Types

Create a monitoring query:

```javascript
// Add to your monitoring dashboard
const tokenStats = {
  rs256Tokens: await Session.countDocuments({ 
    createdAt: { $gte: migrationStartDate }
  }),
  hs256Tokens: await Session.countDocuments({
    createdAt: { $lt: migrationStartDate },
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  })
};

console.log(`RS256: ${tokenStats.rs256Tokens}, HS256: ${tokenStats.hs256Tokens}`);
```

#### 3.2 Expected Migration Timeline

| Day | RS256 Tokens | HS256 Tokens | Notes |
|-----|--------------|--------------|-------|
| 0 | 0% | 100% | Migration deployed |
| 1 | ~50% | ~50% | Active users login |
| 3 | ~80% | ~20% | Most users migrated |
| 7 | ~98% | ~2% | Refresh tokens expired |
| 8 | 100% | 0% | Safe to disable HS256 |

---

### **Phase 4: Finalization (15 minutes)**

#### 4.1 Disable Migration Mode

After 7 days (or when HS256 token count < 1%):

Update `.env`:
```bash
# Disable migration mode
JWT_MIGRATION_MODE=false

# Remove JWT_SECRET (no longer needed)
# JWT_SECRET=your-current-secret-here  ← Comment out or remove
```

#### 4.2 Restart Services

```bash
# Restart production servers
pm2 restart kmit-clubs-backend

# Or if using docker
docker-compose restart backend
```

#### 4.3 Verify RS256 Only

```bash
# Check configuration
curl https://api.kmit.edu/api/auth/jwt-info

# Expected response:
{
  "algorithm": "RS256",
  "migrationMode": false,  ← Should be false
  "supportsHS256Fallback": false,  ← Should be false
  "keySource": "files"
}
```

#### 4.4 Test Old Token Rejection

```bash
# Old HS256 tokens should now fail
curl https://api.kmit.edu/api/users/me \
  -H "Authorization: Bearer <old-hs256-token>"

# Expected: 401 Unauthorized
{
  "message": "Invalid token",
  "reason": "invalid"
}
```

---

## 🚀 **Production Deployment**

### **Option A: File-Based Keys (Recommended for VMs)**

**Environment Variables:**
```bash
JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_PATH=/secure/path/keys/jwt-private.pem
JWT_PUBLIC_KEY_PATH=/secure/path/keys/jwt-public.pem
```

**Key Storage:**
- Store keys in secure directory outside web root
- Set restrictive permissions: `chmod 600 jwt-private.pem`
- Back up keys securely
- Add to `.gitignore`

---

### **Option B: Environment Variables (Recommended for Containers)**

**Generate Base64-Encoded Keys:**
```bash
# Private key
cat keys/jwt-private.pem | base64 | tr -d '\n' > jwt-private.b64

# Public key
cat keys/jwt-public.pem | base64 | tr -d '\n' > jwt-public.b64
```

**Environment Variables:**
```bash
JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY=<paste-base64-encoded-private-key>
JWT_PUBLIC_KEY=<paste-base64-encoded-public-key>
```

**Docker Example:**
```yaml
# docker-compose.yml
services:
  backend:
    environment:
      - JWT_ALGORITHM=RS256
      - JWT_PRIVATE_KEY=${JWT_PRIVATE_KEY}
      - JWT_PUBLIC_KEY=${JWT_PUBLIC_KEY}
    secrets:
      - jwt_private_key
      - jwt_public_key
```

---

### **Option C: Secrets Manager (Best for Cloud)**

#### AWS Secrets Manager

```bash
# Store keys in AWS Secrets Manager
aws secretsmanager create-secret \
  --name kmit-clubs/jwt-private-key \
  --secret-string file://keys/jwt-private.pem

aws secretsmanager create-secret \
  --name kmit-clubs/jwt-public-key \
  --secret-string file://keys/jwt-public.pem
```

**Load in Application:**
```javascript
// Load from AWS Secrets Manager at startup
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

async function loadJWTKeys() {
  const privateKey = await secretsManager.getSecretValue({
    SecretId: 'kmit-clubs/jwt-private-key'
  }).promise();
  
  const publicKey = await secretsManager.getSecretValue({
    SecretId: 'kmit-clubs/jwt-public-key'
  }).promise();
  
  process.env.JWT_PRIVATE_KEY = Buffer.from(privateKey.SecretString).toString('base64');
  process.env.JWT_PUBLIC_KEY = Buffer.from(publicKey.SecretString).toString('base64');
}
```

---

## 🔄 **Key Rotation**

Rotate keys every 6-12 months for security:

### **Rotation Steps**

1. **Generate new key pair:**
   ```bash
   npm run generate:rsa-keys
   # Rename old keys
   mv keys/jwt-private.pem keys/jwt-private.pem.old
   mv keys/jwt-public.pem keys/jwt-public.pem.old
   ```

2. **Update environment with new keys**

3. **Deploy** (old tokens fail immediately)

4. **Users re-login automatically**

---

## 🐛 **Troubleshooting**

### **Problem: Server Won't Start**

**Error:** `Failed to load JWT keys`

**Solution:**
```bash
# Check file paths
ls -la keys/

# Check permissions
chmod 600 keys/jwt-private.pem
chmod 644 keys/jwt-public.pem

# Verify keys are valid PEM format
openssl rsa -in keys/jwt-private.pem -check
```

---

### **Problem: Tokens Not Verified**

**Error:** `Invalid token`

**Solution:**
```bash
# Check JWT_MIGRATION_MODE if old tokens
echo $JWT_MIGRATION_MODE  # Should be 'true' during migration

# Check algorithm mismatch
curl http://localhost:5000/api/auth/jwt-info

# Decode token to see algorithm
jwt decode <token>
```

---

### **Problem: Migration Mode Not Working**

**Symptoms:** Old HS256 tokens fail immediately

**Solution:**
1. Verify `JWT_MIGRATION_MODE=true` in `.env`
2. Verify `JWT_SECRET` is still present
3. Check logs for migration messages
4. Restart server after `.env` changes

---

## ✅ **Post-Migration Checklist**

- [ ] RSA keys generated and secured
- [ ] Keys backed up in secure location
- [ ] Environment variables updated
- [ ] Migration mode enabled
- [ ] Deployed to staging and tested
- [ ] Deployed to production
- [ ] Monitoring active for 7 days
- [ ] HS256 token count < 1%
- [ ] Migration mode disabled
- [ ] JWT_SECRET removed from `.env`
- [ ] Old keys archived securely
- [ ] Documentation updated
- [ ] Team notified of completion

---

## 📊 **Performance Impact**

| Metric | HS256 | RS256 | Change |
|--------|-------|-------|--------|
| **Sign Time** | ~0.1ms | ~0.5ms | +400% |
| **Verify Time** | ~0.1ms | ~0.3ms | +200% |
| **Token Size** | ~200 bytes | ~200 bytes | No change |
| **Memory** | Minimal | Minimal | No change |

**Verdict:** Performance impact negligible for typical API load (<100 tokens/sec)

---

## 🔒 **Security Best Practices**

1. ✅ **Never commit private keys** to version control
2. ✅ **Use proper file permissions** (600 for private, 644 for public)
3. ✅ **Rotate keys periodically** (every 6-12 months)
4. ✅ **Store keys in secrets manager** for production
5. ✅ **Monitor for unauthorized access** attempts
6. ✅ **Use strong key sizes** (minimum 2048-bit)
7. ✅ **Backup keys securely** (encrypted backups)
8. ✅ **Audit key access** regularly

---

## 📚 **Additional Resources**

- [JWT.io - RS256 Documentation](https://jwt.io/)
- [RFC 7519 - JSON Web Token](https://tools.ietf.org/html/rfc7519)
- [OWASP JWT Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [Node.js Crypto Documentation](https://nodejs.org/api/crypto.html)

---

**Migration Completed:** TBD  
**Migrated By:** TBD  
**Next Key Rotation:** TBD (6 months after migration)


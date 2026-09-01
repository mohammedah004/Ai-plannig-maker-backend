import http from "http";
import url from "url";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CALLBACK_PORT = 3001;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("\n❌ Error: Missing Google OAuth credentials.");
  console.error("Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env first.\n");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Scopes required for creating spreadsheets and sharing them via Google Drive
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // Guarantees a refresh_token is returned every time
  scope: SCOPES,
});

console.log("\n==================================================================");
console.log(" 🔑 GOOGLE SHEETS & DRIVE OAUTH2 OWNER AUTHORIZATION HELPER");
console.log("==================================================================\n");
console.log("1. Open the following URL in your browser using YOUR personal Google account:\n");
console.log(`\x1b[36m${authUrl}\x1b[0m\n`);
console.log("2. Grant permissions to create and manage spreadsheets.");
console.log("3. You will be redirected to http://localhost:3001/oauth2callback automatically.\n");
console.log(`⏳ Listening for authorization callback on port ${CALLBACK_PORT}...\n`);

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = url.parse(req.url, true);

    if (reqUrl.pathname === "/oauth2callback") {
      const code = reqUrl.query.code;
      const error = reqUrl.query.error;

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h2>❌ Authorization Failed: ${error}</h2><p>You can close this tab and try again.</p>`);
        console.error(`❌ OAuth Error received from Google: ${error}`);
        server.close();
        process.exit(1);
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>❌ No authorization code received.</h2>");
        return;
      }

      // Exchange authorization code for tokens
      const { tokens } = await oauth2Client.getToken(code);

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <div style="font-family: system-ui, sans-serif; text-align: center; padding: 40px;">
          <h1 style="color: #10b981;">✅ Authorization Successful!</h1>
          <p>You can close this tab and return to your terminal.</p>
        </div>
      `);

      console.log("\n==================================================================");
      console.log(" 🎉 SUCCESS! AUTHORIZATION TOKENS RECEIVED");
      console.log("==================================================================\n");

      if (tokens.refresh_token) {
        console.log("📋 Copy this REFRESH TOKEN and add it to your .env:\n");
        console.log(`\x1b[32mGOOGLE_SHEETS_OWNER_REFRESH_TOKEN=${tokens.refresh_token}\x1b[0m\n`);
        console.log("⚠️  SECURITY WARNING:");
        console.log("   - Never commit this refresh token to Git.");
        console.log("   - Paste it into Render.com Environment Variables in production.\n");
      } else {
        console.warn("⚠️ Warning: No refresh_token was returned in this exchange.");
        console.warn("If you already authorized this app, revoke access at:");
        console.warn("https://myaccount.google.com/permissions and run this script again.\n");
      }

      server.close();
      process.exit(0);
    }
  } catch (err) {
    console.error("❌ Exception exchanging authorization code:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal error exchanging authorization code.");
    server.close();
    process.exit(1);
  }
});

server.listen(CALLBACK_PORT, () => {
  // Server ready
});

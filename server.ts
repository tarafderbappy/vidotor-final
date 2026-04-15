import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // YouTube Binary Proxy - Must be before express.json() to handle raw stream
  app.put("/api/yt/upload-binary", async (req, res) => {
    const uploadUrl = req.query.uploadUrl as string;
    if (!uploadUrl) return res.status(400).json({ error: "Missing uploadUrl" });

    console.log("Proxying binary upload to YouTube...");

    try {
      const response = await axios({
        method: 'put',
        url: uploadUrl,
        data: req, // Pipe the incoming request stream directly to Google
        headers: {
          'Content-Type': req.headers['content-type'] || 'video/mp4',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      console.log("Binary proxy upload successful");
      res.json(response.data);
    } catch (error: any) {
      console.error("Binary Proxy Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // YouTube Upload Proxy to avoid CORS issues
  app.post("/api/yt/init-upload", async (req, res) => {
    console.log("Received YouTube upload initiation request");
    const { metadata, accessToken, fileSize, fileType } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: "Missing access token" });
    }

    try {
      const response = await axios.post(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        metadata,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Length': fileSize.toString(),
            'X-Upload-Content-Type': fileType,
            'User-Agent': 'Vidotor-App/1.0'
          }
        }
      );

      const uploadUrl = response.headers['location'];
      if (!uploadUrl) {
        console.error("YouTube API did not return a Location header for resumable upload");
        return res.status(200).json({ success: false, error: "No upload URL received from YouTube" });
      }

      console.log("Successfully generated YouTube upload URL:", uploadUrl.substring(0, 60) + "...");
      res.json({ success: true, uploadUrl });
    } catch (error: any) {
      const errorData = error.response?.data;
      console.error("YouTube Proxy Error Details:", JSON.stringify(errorData, null, 2));
      
      // We return 200 even on error to ensure the JSON payload reaches the client 
      // and isn't intercepted by infrastructure proxies (which often replace 403/500 with HTML)
      res.status(200).json({ 
        success: false, 
        error: errorData?.error?.message || error.message || "Internal Server Error",
        details: errorData
      });
    }
  });

  // API 404 handler
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

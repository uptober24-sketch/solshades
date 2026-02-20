export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const r = await fetch("https://api.openai.com/v1/images", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1.5",
        prompt,
        size: "1536x1024",
        response_format: "b64_json",
      }),
    });

    const json = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: json?.error || json });
    }

    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: "Missing b64 image data" });

    const imgBuffer = Buffer.from(b64, "base64");

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", imgBuffer.length);
    return res.status(200).send(imgBuffer);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

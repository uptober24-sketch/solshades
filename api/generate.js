export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1.5",
        prompt,
        size: "1024x1024",
        output_format: "jpeg"
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      // Forward OpenAI error cleanly
      return res.status(r.status).json({ error: data.error || data });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ error: "No image returned", raw: data });
    }

    const img = Buffer.from(b64, "base64");

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(img);
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

import formidable from "formidable";
import fs from "fs";

export const config = {
  api: { bodyParser: false }, // dôležité pre file upload
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = formidable({ multiples: false });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    const prompt = (fields.prompt || "").toString();
    const imageFile = files.image;

    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    if (!imageFile) return res.status(400).json({ error: "Missing image file (field name: image)" });

    const imagePath = imageFile.filepath;
    const imageStream = fs.createReadStream(imagePath);

    const fd = new FormData();
    fd.append("model", "gpt-image-1.5");
    fd.append("prompt", prompt);
    fd.append("size", "1536x1024");
    fd.append("output_format", "jpeg");
    fd.append("image", imageStream, imageFile.originalFilename || "image.jpg");

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: fd,
    });

    // OpenAI môže vrátiť buď image bytes alebo JSON error
    const contentType = r.headers.get("content-type") || "";
    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: errText });
    }

    // Ak príde binárny jpeg:
    if (contentType.includes("image/")) {
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", "image/jpeg");
      return res.status(200).send(buf);
    }

    // fallback (ak by prišlo JSON)
    const json = await r.json();
    return res.status(200).json(json);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

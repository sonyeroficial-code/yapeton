import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido" });
  }

  try {
    const { token, to, nombre, monto, codigo } = req.body || {};

    if (token !== process.env.SMS_APP_TOKEN) {
      return res.status(401).json({ ok: false, error: "Token invalido" });
    }

    if (!to || !nombre || !monto || !codigo) {
      return res.status(400).json({ ok: false, error: "Faltan datos" });
    }

    const mensaje = `Sonyer:
${nombre} te envio un pago por S/ ${monto}.
Codigo: ${codigo}`;

    const result = await client.messages.create({
      body: mensaje,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      to
    });

    return res.status(200).json({
      ok: true,
      sid: result.sid,
      status: result.status
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Error enviando SMS"
    });
  }
}

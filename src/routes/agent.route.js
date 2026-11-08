const router = require('express').Router();
const { z } =require("zod") ;
const { runAgent } = require("../ai/agentService.js");


const chatRequestSchema = z.object({
  conversationId: z.string().min(1).max(100),
  msisdn: z.string().regex(/^62[0-9]{8,15}$/),
  message: z.string().min(1).max(1000)
});


router.post("/chat", async (req, res, next) => {
  try {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Request agent tidak valid",
          details: parsed.error.flatten()
        }
      });
    }
    const result = await runAgent({
      userMessage: parsed.data.message,
      msisdn: parsed.data.msisdn,
      history: []
    });
    return res.json({
      conversationId: parsed.data.conversationId,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
const router = require('express').Router();
const { z } =require("zod") ;
const { runAgent } = require("../ai/agentService.js");
const { saveConversationRating } = require("../services/ratingService");


const chatRequestSchema = z.object({
  conversationId: z.string().min(1).max(100),
  msisdn: z.string().regex(/^62[0-9]{8,15}$/),
  message: z.string().min(1).max(1000)
});

const ratingRequestSchema = z.object({
  conversationId: z.string().min(1).max(100),
  promptId: z.string().uuid(),
  reason: z.enum(["purchase", "ticket", "handoff"]),
  rating: z.number().int().min(1).max(5)
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

router.post("/rating", async (req, res, next) => {
  try {
    const parsed = ratingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_RATING",
          message: "Rating percakapan tidak valid",
          details: parsed.error.flatten()
        }
      });
    }

    const result = await saveConversationRating(parsed.data);
    return res.json(result);
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({
        error: {
          code: "RATING_ALREADY_SUBMITTED",
          message: error.message
        }
      });
    }
    return next(error);
  }
});

module.exports = router;
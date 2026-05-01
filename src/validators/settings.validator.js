import Joi from "joi";

const pipelineStageSchema = Joi.object({
  name: Joi.string().required().min(1).max(60),
  color: Joi.string()
    .pattern(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
    .required(),
  order: Joi.number().integer().min(0).required(),
});

export const updateSettingsValidator = Joi.object({
  distributionMethod: Joi.string().valid("round_robin", "equal_load", "manual"),
  distributionPool: Joi.array().items(Joi.string().hex().length(24)),
  rrIndex: Joi.number().integer().min(0),
  pipelineStages: Joi.array().items(pipelineStageSchema),
  permissions: Joi.object(),
  rbacExecOnly: Joi.boolean(),
  rbacCoEditorsCanEdit: Joi.boolean(),
  leadColumns: Joi.array().items(Joi.string()),
  customColumns: Joi.array().items(
    Joi.object({
      key: Joi.string().required(),
      label: Joi.string().required(),
      visible: Joi.boolean().required(),
    }),
  ),
  gcalConnected: Joi.boolean(),
  gcalUser: Joi.string().email().allow(""),
  gmailEnabled: Joi.boolean(),
  gateways: Joi.object(),
  defaultGateway: Joi.string().allow(""),
  paymentLinkExpiry: Joi.number().integer().min(1),
  aiProvider: Joi.string().valid("openai", "anthropic", "gemini", "custom", ""),
  aiKey: Joi.string().allow(""),
  aiModel: Joi.string().allow(""),
  aiEndpoint: Joi.string().uri().allow(""),
  aiPrompt: Joi.string().allow(""),
  aiAutoAnalyse: Joi.boolean(),
  aiScanNotes: Joi.boolean(),
  aiIntent: Joi.boolean(),
  companyName: Joi.string().allow(""),
  currency: Joi.string().max(5).allow(""),
  timezone: Joi.string().allow(""),
});

export const updatePipelineStagesValidator = Joi.object({
  pipelineStages: Joi.array().items(pipelineStageSchema).required(),
});

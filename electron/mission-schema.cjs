const text = { type: 'string' };
const strings = { type: 'array', items: text };
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const common = {
  status: { type: 'string', enum: ['ready', 'waiting_user'] },
  summary: text,
  question: text,
  options: strings,
};
const planSchema = object({
  ...common,
  tasks: {
    type: 'array',
    items: object({
      title: text,
      owner: { type: 'string', enum: ['codex', 'claude'] },
      files: strings,
      acceptance: text,
    }),
  },
});
const reviewSchema = object({ ...common, approved: { type: 'boolean' }, issues: strings });
module.exports = { planSchema, reviewSchema };

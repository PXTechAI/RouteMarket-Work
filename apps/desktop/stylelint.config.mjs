export default {
  extends: ["stylelint-config-standard-scss"],
  rules: {
    "at-rule-empty-line-before": null,
    "declaration-block-no-redundant-longhand-properties": null,
    "declaration-block-single-line-max-declarations": null,
    "font-family-name-quotes": null,
    "media-feature-range-notation": null,
    "no-descending-specificity": null,
    "rule-empty-line-before": null,
    "selector-class-pattern": null,
    "scss/at-mixin-pattern": "^[a-z][a-z0-9-]+$",
    "scss/dollar-variable-pattern": "^[a-z][a-z0-9-]+$",
    "scss/dollar-variable-empty-line-before": null,
    "scss/percent-placeholder-pattern": "^[a-z][a-z0-9-]+$",
  },
};

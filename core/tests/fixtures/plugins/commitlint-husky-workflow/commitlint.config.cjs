module.exports = {
  extends: ["@commitlint/config-conventional", "./config/commitlint-local.cjs"],
  plugins: ["jira"],
};

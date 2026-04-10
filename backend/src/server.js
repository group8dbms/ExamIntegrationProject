const app = require("./app");
const env = require("./config/env");

app.listen(env.port, () => {
  console.log(`Exam integrity backend listening on port ${env.port}`);
});

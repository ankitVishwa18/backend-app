const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(
  process.env.DB_DATABASE,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || process.env.SERVER_PORT || 3306),
    dialect: process.env.DB_CONNECTION || "mysql",
    logging: false,
    dialectOptions:
      (process.env.DB_SSL || "true").toLowerCase() === "false"
        ? {}
        : {
            ssl: {
              require: true,
              rejectUnauthorized: false,
            },
          },
  }
);

module.exports = sequelize;

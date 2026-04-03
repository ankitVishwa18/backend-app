"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(_models) {}
  }

  User.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      google_id: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      microsoft_id: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      google_access_token: { type: DataTypes.TEXT },
      google_refresh_token: { type: DataTypes.TEXT },
      google_token_expiry: { type: DataTypes.TEXT },
    },
    {
      sequelize,
      modelName: "User",
      tableName: "users",
      timestamps: false,
    },
  );

  return User;
};

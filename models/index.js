const mongoose = require("mongoose");

const Account = require("./account.model");
const Category = require("./category.model");
const Product = require("./product.model");
const Skin = require("./skin.model");
const Brand = require("./brand.model");
const Order = require("./order.model");
const Feedback = require("./feedback.model");
const Promotion = require("./promotion.model");
const Routine = require("./routine.model");
const QuizQuestion = require("./quiz.model");

const db = {};

db.Account = Account;
db.Category = Category;
db.Product = Product;
db.Skin = Skin;
db.Brand = Brand;
db.Order = Order;
db.Feedback = Feedback;
db.Promotion = Promotion;
db.Routine = Routine;
db.QuizQuestion = QuizQuestion;

db.connectDb = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI).then(() => {
      console.log("Database connection successful!!!");
    });
  } catch (error) {
    next(error);
    process.exit();
  }
};

module.exports = db;

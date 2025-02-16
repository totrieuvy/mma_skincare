const express = require("express");
const db = require("../models/index");
const crypto = require("crypto");
const { VNPay, ignoreLogger, ProductCode, VnpLocale, dateFormat } = require("vnpay");
const roleMiddleware = require("../middleware/roleMiddleware");
const authMiddleware = require("../middleware/authMiddleware");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");
const moment = require("moment");
const axios = require("axios");
const CryptoJS = require("crypto-js");

const orderRoute = express.Router();

/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: API for orders
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Order:
 *       type: object
 *       properties:
 *         account:
 *           type: string
 *           description: The ID of the account
 *         status:
 *           type: string
 *           enum: ["Pending", "Paid"]
 *           description: The status of the order
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               product:
 *                 type: string
 *                 description: The ID of the product
 *               quantity:
 *                 type: number
 *                 description: The quantity of the product
 *         totalAmount:
 *           type: number
 *           description: The total amount of the order
 *       required:
 *         - account
 *         - status
 *         - items
 *         - totalAmount
 */

/**
 * @swagger
 * /api/order/add-to-cart:
 *   post:
 *     tags:
 *       - Orders
 *     summary: Add items to the cart and create a VNPAY payment URL
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               account:
 *                 type: string
 *                 description: The account ID
 *                 example: "64f8a6d123abc4567e891011"
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     product:
 *                       type: string
 *                       description: The product ID
 *                       example: "64f8a6d123abc4567e891011"
 *                     quantity:
 *                       type: number
 *                       description: The quantity of the product
 *                       example: 2
 *     responses:
 *       201:
 *         description: VNPAY payment URL created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 vnpayResponse:
 *                   type: object
 *                   description: The VNPAY payment URL response
 *       400:
 *         description: Bad request
 *       404:
 *         description: Product not found
 *       500:
 *         description: Internal server error
 */
orderRoute.post("/add-to-cart", authMiddleware, roleMiddleware(["customer"]), async (req, res) => {
  try {
    const { account, items, promotion } = req.body; // Set default value for promotion

    if (!account || !items || items.length === 0) {
      return res.status(400).json({ message: "An order must contain at least one product." });
    }

    let totalAmount = 0;
    const updatedProducts = [];

    for (const item of items) {
      const product = await db.Product.findById(item.product);
      if (!product) {
        return res.status(404).json({ message: `Product with ID ${item.product} not found.` });
      }

      if (product.quantity < item.quantity) {
        return res.status(400).json({
          message: `Not enough stock for ${product.name}. Available: ${product.quantity}, Requested: ${item.quantity}`,
        });
      }

      totalAmount += item.quantity * product.price;
      product.quantity -= item.quantity;
      updatedProducts.push(product);
    }

    // Save product stock changes
    for (const product of updatedProducts) {
      await product.save();
    }

    // Create order with status "Pending"
    const newOrder = new db.Order({
      account,
      items,
      promotion: promotion || null,
      totalAmount,
      status: "Pending",
    });

    await newOrder.save();

    const vnpay = new VNPay({
      tmnCode: "9TKDVWYK",
      secureSecret: "LH6SD44ECTBWU1PHK3D2YCOI5HLUWGPH",
      vnpayHost: "https://sandbox.vnpayment.vn",
      testMode: true,
      hashAlgorithm: "SHA512",
      enableLog: true,
      loggerFn: ignoreLogger,
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const vnpayResponse = await vnpay.buildPaymentUrl({
      vnp_Amount: totalAmount,
      vnp_IpAddr: "127.0.0.1",
      vnp_TxnRef: newOrder._id.toString(),
      vnp_OrderInfo: `${newOrder._id}`,
      vnp_OrderType: ProductCode.Other,
      vnp_ReturnUrl: `https://yourwebsite.com/vnpay-return?orderId=${newOrder._id}`,
      vnp_Locale: VnpLocale.VN,
      vnp_CreateDate: dateFormat(new Date()),
      vnp_ExpireDate: dateFormat(tomorrow),
    });

    return res.status(201).json({ vnpayResponse, orderId: newOrder._id });
  } catch (error) {
    res.status(500).json({ message: "Server error.", error: error.message });
  }
});

/**
 * @swagger
 * /api/order/account/{id}:
 *   get:
 *     tags:
 *       - Orders
 *     summary: Get orders by account ID
 *     description: Retrieve all orders for a specific account by account ID.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the account
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Order'
 *       400:
 *         description: Bad request
 *       404:
 *         description: Account not found
 *       500:
 *         description: Internal server error
 */
orderRoute.get("/account/:id", authMiddleware, roleMiddleware(["customer"]), async (req, res) => {
  try {
    const orders = await db.Order.find({ account: req.params.id });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: "Server error.", error: error.message });
  }
});

/**
 * @swagger
 * /api/order/cancel-order/{orderId}:
 *   post:
 *     tags:
 *       - Orders
 *     summary: Cancel an order by ID
 *     description: Cancel an order and refund 50% of the total amount to the customer's account.
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the order to be canceled
 *     responses:
 *       200:
 *         description: Order canceled and 50% refund issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Order has been canceled and 50% refund issued. Product quantities have been updated in the inventory."
 *                 refundAmount:
 *                   type: number
 *                   description: The amount refunded to the customer's account
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */
orderRoute.post("/cancel-order/:orderId", authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await db.Order.findById(orderId).populate("items.product");

    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }

    if (order.status !== "Paid") {
      return res.status(400).json({ message: "Only paid orders can be canceled." });
    } else {
      const refundAmount = order.totalAmount * 0.5;

      for (const item of order.items) {
        const product = await db.Product.findById(item.product._id);
        if (product) {
          product.quantity += item.quantity;
          await product.save();
        }

        order.status = "Canceled";
        await order.save();

        const formattedItems = order.items.map((item) => ({
          productName: item.product?.name || "Unknown Product",
          quantity: item.quantity,
          price: item.product?.price || 0,
          total: item.quantity * item.product?.price || 0,
        }));
        const emailTemplatePath = path.join(__dirname, "../templates/refundTemplate.html");
        const emailTemplateSource = fs.readFileSync(emailTemplatePath, "utf8");
        const emailTemplate = handlebars.compile(emailTemplateSource);
        const emailHtml = emailTemplate({ orderId, refundAmount, items: formattedItems });

        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        });

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: account.email,
          subject: "Xác nhận hoàn tiền đơn hàng",
          html: emailHtml,
        };

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) console.error("Lỗi gửi email:", error);
          else console.log("Email sent:", info.response);
        });

        return res.status(200).json({
          message: "Đơn hàng đã được hủy và hoàn tiền 50%. Số lượng sản phẩm đã được cập nhật vào kho.",
          refundAmount,
        });
      }
    }
  } catch (error) {
    res.status(500).json({ message: "Lỗi máy chủ", error: error.message });
  }
});

orderRoute.get("/vnpay-return", async (req, res) => {
  try {
    const { vnp_ResponseCode, vnp_TxnRef } = req.query;

    if (vnp_ResponseCode === "00") {
      // "00" indicates successful payment
      await db.Order.findByIdAndUpdate(vnp_TxnRef, { status: "Paid" });

      return res.redirect("https://yourwebsite.com/payment-success");
    } else {
      return res.redirect("https://yourwebsite.com/payment-failed");
    }
  } catch (error) {
    res.status(500).json({ message: "Server error.", error: error.message });
  }
});

module.exports = orderRoute;

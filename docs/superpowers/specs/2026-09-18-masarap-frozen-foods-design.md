# Design Spec: Masarap Frozen Foods E-commerce

**Date:** 2026-09-18
**Status:** Approved Concept

## 1. Purpose
A local e-commerce platform for selling frozen foods (specifically hotdogs and related products) with a focus on high-trust local delivery.

## 2. User Experience
- **Home Page**: High-conversion hero section, featured products, and a "Meet the Founder" section featuring the owner's photo.
- **Catalog**: Grid view of products with categories, pricing, and "Add to Cart" functionality.
- **Cart**: Slide-out drawer for quick review.
- **Checkout**: Local-specific form (Name, Contact, Address, Delivery Slot).
- **Payment**: Integrated online payment (Stripe/PayPal).

## 3. Architecture
- **Frontend**: Next.js 14+ (App Router) for SEO and performance.
- **Styling**: Tailwind CSS for a modern, responsive UI.
- **State Management**: Zustand or React Context for the shopping cart.
- **Backend**: Next.js API Routes.
- **Database**: SQLite (via Prisma) for simple, portable product and order management.
- **Images**: Optimized via Next/Image.

## 4. Data Model
- **Product**: `id, name, description, price, image_url, category, stock_quantity`.
- **Order**: `id, customer_name, customer_phone, address, total_amount, status, created_at, delivery_slot`.
- **OrderItem**: `id, order_id, product_id, quantity, unit_price`.

## 5. Constraints & Success Criteria
- **Mobile First**: Most local orders happen on phones.
- **Fast Load**: Critical for conversion.
- **Trust**: Prominent use of the founder's image to emphasize local business.

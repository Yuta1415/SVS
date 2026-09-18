# Masarap Frozen Foods E-commerce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully functional local e-commerce site for frozen foods featuring a high-trust UI and a seamless local delivery checkout.

**Architecture:** Next.js App Router for the frontend and API, Prisma with SQLite for the backend, and Tailwind CSS for styling.

**Tech Stack:** Next.js 14+, Tailwind CSS, Prisma, SQLite, Zustand (Cart state).

**Spec:** `docs/superpowers/specs/2026-09-18-masarap-frozen-foods-design.md`

## Global Constraints
- Mobile First: Responsive design for mobile users.
- Trust-Centric: Prominent use of founder's image.
- Local Focus: Checkout simplified for local delivery.
- Palette: Red, Yellow, White.

---

## File Structure
- `prisma/schema.prisma`: Database models.
- `lib/prisma.ts`: Singleton Prisma client.
- `store/useCart.ts`: Zustand store for shopping cart.
- `app/page.tsx`: Home page (Hero + Founder section).
- `app/products/page.tsx`: Catalog page.
- `app/api/products/route.ts`: Product list API.
- `app/api/orders/route.ts`: Order creation API.
- `components/ui/`: Atomic components (Button, Input).
- `components/cart/CartDrawer.tsx`: Slide-out cart UI.
- `components/products/ProductCard.tsx`: Product item UI.
- `components/checkout/CheckoutForm.tsx`: Local delivery form.

---

### Task 1: Project Initialization & Database Setup

**Files:**
- Create: `package.json` (via `npx create-next-app`)
- Create: `prisma/schema.prisma`
- Create: `lib/prisma.ts`

**Interfaces:**
- Produces: `prisma.product`, `prisma.order`, `prisma.orderItem`

- [ ] **Step 1: Initialize Next.js project**
  Run: `npx create-next-app@latest . --typescript --tailwind --eslint --app` (Use defaults: Src dir No, App Router Yes, Import Alias @/*)
- [ ] **Step 2: Install Prisma and Zustand**
  Run: `npm install @prisma/client zustand` and `npm install -D prisma`
- [ ] **Step 3: Define schema in `prisma/schema.prisma`**
```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

generator client {
  provider = "prisma-client-js"
}

model Product {
  id          Int       @id @default(autoincrement())
  name        String
  description String
  price       Float
  image_url   String
  category    String
  stock       Int       @default(0)
  items       OrderItem[]
}

model Order {
  id            Int         @id @default(autoincrement())
  customerName  String
  customerPhone String
  address       String
  totalAmount   Float
  status        String       @default("PENDING")
  deliverySlot   String
  createdAt     DateTime    @default(now())
  items         OrderItem[]
}

model OrderItem {
  id        Int     @id @default(autoincrement())
  orderId   Int
  productId Int
  quantity  Int
  unitPrice Float
  order     Order   @relation(fields: [orderId], references: [id])
  product   Product @relation(fields: [productId], references: [id])
}
```
- [ ] **Step 4: Create Prisma client singleton in `lib/prisma.ts`**
```typescript
import { PrismaClient } from '@prisma/client';
const globalForPrisma = global as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```
- [ ] **Step 5: Run migration and seed basic data**
  Run: `npx prisma migrate dev --name init`
- [ ] **Step 6: Commit**
  `git add . && git commit -m "chore: init project and database schema"`

### Task 2: Product Catalog & API

**Files:**
- Create: `app/api/products/route.ts`
- Create: `app/products/page.tsx`
- Create: `components/products/ProductCard.tsx`

**Interfaces:**
- Consumes: `prisma.product`
- Produces: `Product[]`

- [ ] **Step 1: Implement `app/api/products/route.ts`**
```typescript
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const products = await prisma.product.findMany();
  return NextResponse.json(products);
}
```
- [ ] **Step 2: Create `components/products/ProductCard.tsx`**
  Implement a card with image, name, price, and an "Add to Cart" button.
- [ ] **Step 3: Implement `app/products/page.tsx`**
  Fetch products from API and render them in a responsive grid.
- [ ] **Step 4: Seed 3-5 realistic frozen food products via `npx prisma studio`**
- [ ] **Step 5: Commit**
  `git add . && git commit -m "feat: add product catalog and api"`

### Task 3: Shopping Cart State & UI

**Files:**
- Create: `store/useCart.ts`
- Create: `components/cart/CartDrawer.tsx`

**Interfaces:**
- Produces: `cartItems`, `addToCart()`, `removeFromCart()`, `clearCart()`

- [ ] **Step 1: Create Zustand store in `store/useCart.ts`**
```typescript
import { create } from 'zustand';

interface CartItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  addItem: (product: any) => void;
  removeItem: (id: number) => void;
  clearCart: () => void;
  total: () => number;
}

export const useCart = create<CartStore>((set, get) => ({
  items: [],
  addItem: (product) => set((state) => {
    const existing = state.items.find(i => i.id === product.id);
    if (existing) return { items: state.items.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i) };
    return { items: [...state.items, { ...product, quantity: 1 }] };
  }),
  removeItem: (id) => set((state) => ({ items: state.items.filter(i => i.id !== id) })),
  clearCart: () => set({ items: [] }),
  total: () => get().items.reduce((acc, item) => acc + item.price * item.quantity, 0),
}));
```
- [ ] **Step 2: Implement `components/cart/CartDrawer.tsx`**
  A slide-out overlay showing current items and a "Proceed to Checkout" button.
- [ ] **Step 3: Integrate `CartDrawer` into `app/layout.tsx`**
- [ ] **Step 4: Connect "Add to Cart" buttons in `ProductCard.tsx` to the store.**
- [ ] **Step 5: Commit**
  `git add . && git commit -m "feat: implement shopping cart state and ui"`

### Task 4: Local Delivery Checkout & Order API

**Files:**
- Create: `app/checkout/page.tsx`
- Create: `components/checkout/CheckoutForm.tsx`
- Create: `app/api/orders/route.ts`

**Interfaces:**
- Consumes: `useCart`, `prisma.order`, `prisma.orderItem`
- Produces: `orderId`

- [ ] **Step 1: Implement `app/api/orders/route.ts`**
  Create a POST handler that saves an Order and its OrderItems to the DB.
- [ ] **Step 2: Create `components/checkout/CheckoutForm.tsx`**
  Form fields: Name, Phone, Address, Delivery Slot (Dropdown: Morning, Afternoon, Evening).
- [ ] **Step 3: Implement `app/checkout/page.tsx`**
  Render the form and call the Order API on submit.
- [ ] **Step 4: Add a "Success" page or toast upon successful order.**
- [ ] **Step 5: Commit**
  `git add . && git commit -m "feat: implement local checkout and order api"`

### Task 5: Home Page & Visual Polish

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Founder's image (provided by user)

- [ ] **Step 1: Configure Tailwind colors in `tailwind.config.ts`**
  Add `brand-red: #D32F2F`, `brand-yellow: #FFC107`.
- [ ] **Step 2: Build the Hero Section in `app/page.tsx`**
  Big bold headline, a "Shop Now" button leading to `/products`.
- [ ] **Step 3: Build "Meet the Founder" section in `app/page.tsx`**
  Use the provided image of the dad, a warm bio, and "Quality Guaranteed" badge.
- [ ] **Step 4: Final UI polish**
  Add a footer, ensure mobile responsiveness, and optimize images.
- [ ] **Step 5: Commit**
  `git add . && git commit -m "feat: finish home page and visual polish"`

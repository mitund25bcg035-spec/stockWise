import crypto from 'node:crypto';
import { db, withTransaction } from './db.ts';
import { cleanExtractedText, hashContent } from './ai/chunker.ts';
import { SAMPLE_KNOWLEDGE_DOCUMENTS } from './ai/knowledgeSeed.ts';

function daysAgoIso(daysAgo: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

function daysFromNowDate(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

export function seedInitialDataIfEmpty(): void {
  const bizCount = db.prepare('SELECT COUNT(*) as c FROM businesses').get() as { c: number };
  if (bizCount.c === 0) {
    db.prepare(
      `INSERT INTO businesses (id, name, logo_url, email, phone, address, currency, tax_rate, theme, date_format, language, low_stock_alerts_enabled)
       VALUES (1, 'StockWise Operations', '', 'operations@stockwise.io', '+1 (415) 890-4410', '740 Market Street, Suite 400, San Francisco, CA 94103', 'USD', 8.5, 'light', 'MMM DD, YYYY', 'en', 1)`
    ).run();
  }

  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number };
  const prodCount = db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number };

  if (catCount.c > 0 || prodCount.c > 0) {
    return;
  }

  withTransaction(() => {
    const insertCategory = db.prepare(
      'INSERT INTO categories (business_id, name, description, color) VALUES (1, ?, ?, ?)'
    );
    const catHardware = Number(insertCategory.run('Hardware & Peripherals', 'Workstation keyboards, docks, monitors, and input devices', '#C5F36B').lastInsertRowid);
    const catAudio = Number(insertCategory.run('Studio Audio', 'Microphones, studio monitors, and acoustic interfaces', '#68B88A').lastInsertRowid);
    const catNetworking = Number(insertCategory.run('Networking & Power', 'Managed switches, PoE injectors, and surge protection', '#89919A').lastInsertRowid);
    const catPackaging = Number(insertCategory.run('Packaging & Supplies', 'Corrugated mailers, thermal labels, and protective inserts', '#E6B65C').lastInsertRowid);
    const catAccessories = Number(insertCategory.run('Cables & Adapters', 'Braided USB-C, Thunderbolt 4, and HDMI interconnects', '#7CC6FE').lastInsertRowid);

    const insertSupplier = db.prepare(
      `INSERT INTO suppliers (business_id, company_name, contact_name, email, phone, address, city, state, country, notes, status, outstanding_balance, on_time_rate)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    );
    const supNordic = Number(insertSupplier.run('Nordic Precision Components', 'Henrik Lindqvist', 'orders@nordicprecision.com', '+1 (206) 555-0148', '1800 Westlake Ave N', 'Seattle', 'WA', 'USA', 'Primary supplier for precision input hardware and docks.', 0, 98).lastInsertRowid);
    const supVanguard = Number(insertSupplier.run('Vanguard Acoustics Ltd.', 'Claire Beaumont', 'supply@vanguardacoustics.io', '+1 (312) 555-0192', '420 W Huron St', 'Chicago', 'IL', 'USA', 'Audio interfaces and studio condenser hardware.', 0, 94).lastInsertRowid);
    const supApexPack = Number(insertSupplier.run('Apex Corrugated & Print', 'Marcus Vance', 'dispatch@apexpack.co', '+1 (512) 555-0174', '9100 E Cesar Chavez St', 'Austin', 'TX', 'USA', 'Bulk shipping cartons and thermal barcode rolls.', 570, 91).lastInsertRowid);
    const supMeridian = Number(insertSupplier.run('Meridian Silicon Supply', 'Priya Nair', 'b2b@meridiansilicon.com', '+1 (408) 555-0129', '2150 N First St', 'San Jose', 'CA', 'USA', 'Networking switches, fiber optics, and power delivery.', 1710, 96).lastInsertRowid);

    const insertCustomer = db.prepare(
      `INSERT INTO customers (business_id, name, company, email, phone, address, city, notes, status)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'active')`
    );
    const cust1 = Number(insertCustomer.run('Elena Rostova', 'Kestrel Architecture Studio', 'elena@kestrelarch.com', '+1 (415) 555-0181', '550 Townsend St', 'San Francisco, CA', 'Quarterly workstation refresh account.').lastInsertRowid);
    const cust2 = Number(insertCustomer.run('Daniel Mercer', 'Northbound Media Group', 'dmercer@northbound.media', '+1 (212) 555-0136', '115 Broadway', 'New York, NY', 'Podcast & studio buildouts.').lastInsertRowid);
    const cust3 = Number(insertCustomer.run('Sora Takahashi', 'Pacific Logistics Co.', 'sora@pacificlogistics.jp', '+1 (310) 555-0165', '890 Harbor Blvd', 'Long Beach, CA', 'High-volume thermal shipping supplies buyer.').lastInsertRowid);
    const cust4 = Number(insertCustomer.run('Olivia Bennett', 'Foundry Coworking Labs', 'olivia@foundrylabs.co', '+1 (303) 555-0118', '1644 Platte St', 'Denver, CO', 'Desk hubs and networking equipment.').lastInsertRowid);

    const insertProduct = db.prepare(
      `INSERT INTO products (business_id, name, sku, barcode, category_id, supplier_id, purchase_price, selling_price, quantity, reserved_qty, min_stock, max_stock, unit, status, description, image_url, updated_at, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'active', ?, '', ?, ?)`
    );

    const productsSeed = [
      { name: 'Tactile Aluminum Mechanical Keyboard', sku: 'HW-KB-101', barcode: '890101001122', cat: catHardware, sup: supNordic, cost: 74, sell: 149, qty: 42, min: 10, max: 120, unit: 'pcs', desc: 'Hot-swappable CNC aluminum 75% mechanical keyboard with PBT keycaps.' },
      { name: 'Thunderbolt 4 Pro Workstation Dock', sku: 'HW-DK-204', barcode: '890101002044', cat: catHardware, sup: supNordic, cost: 132, sell: 249, qty: 18, min: 8, max: 60, unit: 'pcs', desc: '14-port dual 4K60 dock with 96W host charging and 2.5GbE ethernet.' },
      { name: 'Ergonomic Vertical Wireless Mouse', sku: 'HW-MS-118', barcode: '890101001184', cat: catHardware, sup: supNordic, cost: 34, sell: 69, qty: 7, min: 12, max: 80, unit: 'pcs', desc: 'Dual-mode Bluetooth/2.4GHz ergonomic mouse with magnetic scroll wheel.' },
      { name: '27" Color-Calibrated Studio Display', sku: 'HW-MN-401', barcode: '890101004011', cat: catHardware, sup: supNordic, cost: 310, sell: 549, qty: 9, min: 4, max: 30, unit: 'pcs', desc: '4K IPS matte display, 99% DCI-P3 coverage, factory calibrated.' },
      { name: 'Cardioid Studio Condenser Mic', sku: 'AU-MC-302', barcode: '890202003025', cat: catAudio, sup: supVanguard, cost: 88, sell: 179, qty: 24, min: 8, max: 60, unit: 'pcs', desc: 'Large-diaphragm XLR condenser microphone with internal shock mount.' },
      { name: '2x2 USB-C Low-Noise Audio Interface', sku: 'AU-IF-310', barcode: '890202003100', cat: catAudio, sup: supVanguard, cost: 95, sell: 189, qty: 4, min: 6, max: 40, unit: 'pcs', desc: '24-bit/192kHz studio preamp interface with direct hardware monitoring.' },
      { name: 'Acoustic Foam Isolation Panels (12-Pack)', sku: 'AU-PN-355', barcode: '890202003551', cat: catAudio, sup: supVanguard, cost: 28, sell: 59, qty: 0, min: 10, max: 100, unit: 'pack', desc: 'High-density charcoal acoustic absorption tiles for studio booths.' },
      { name: '8-Port Managed PoE+ Gigabit Switch', sku: 'NW-SW-501', barcode: '890303005012', cat: catNetworking, sup: supMeridian, cost: 115, sell: 219, qty: 15, min: 5, max: 45, unit: 'pcs', desc: 'Fanless rackmount layer-2 managed switch with 120W PoE budget.' },
      { name: '10-Outlet Rackmount Surge Protector', sku: 'NW-PW-522', barcode: '890303005227', cat: catNetworking, sup: supMeridian, cost: 42, sell: 85, qty: 31, min: 8, max: 80, unit: 'pcs', desc: 'Heavy-duty steel PDU with EMI/RFI filtration and 15ft cord.' },
      { name: 'Wi-Fi 6E Ceiling Access Point', sku: 'NW-AP-540', barcode: '890303005401', cat: catNetworking, sup: supMeridian, cost: 108, sell: 199, qty: 3, min: 6, max: 40, unit: 'pcs', desc: 'Tri-band enterprise access point powered via 802.3at PoE+.' },
      { name: 'Thermal Shipping Labels (4x6, 500/Roll)', sku: 'PK-LB-601', barcode: '890404006019', cat: catPackaging, sup: supApexPack, cost: 6.5, sell: 16, qty: 140, min: 30, max: 400, unit: 'roll', desc: 'Perforated direct thermal labels, oil & moisture resistant.' },
      { name: 'Heavy-Duty Kraft Mailer Cartons (25-Pk)', sku: 'PK-BX-615', barcode: '890404006156', cat: catPackaging, sup: supApexPack, cost: 19, sell: 42, qty: 5, min: 12, max: 150, unit: 'pack', desc: 'Double-wall 12x9x4 corrugated shipping boxes.' },
      { name: 'Braided Thunderbolt 4 Cable (2m)', sku: 'CB-TB-701', barcode: '890505007016', cat: catAccessories, sup: supMeridian, cost: 18, sell: 44, qty: 68, min: 15, max: 200, unit: 'pcs', desc: '40Gbps data transfer and 240W USB-PD charging certified.' },
      { name: 'Anodized Aluminum Laptop Stand', sku: 'CB-ST-712', barcode: '890505007122', cat: catAccessories, sup: supNordic, cost: 22, sell: 52, qty: 0, min: 8, max: 80, unit: 'pcs', desc: 'Foldable ventilated riser supporting up to 17-inch workstations.' },
    ];

    const productIds: number[] = [];
    for (const p of productsSeed) {
      const ts = daysAgoIso(40, 9);
      const id = Number(
        insertProduct.run(
          p.name, p.sku, p.barcode, p.cat, p.sup, p.cost, p.sell, p.qty, p.min, p.max, p.unit, p.desc, ts, ts
        ).lastInsertRowid
      );
      productIds.push(id);
    }

    const insertMove = db.prepare(
      `INSERT INTO stock_movements (business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertMove.run(productIds[0], 'purchase', 50, 0, 50, 'Initial warehouse intake', 'PO-2026-0101', daysAgoIso(35, 11));
    insertMove.run(productIds[1], 'purchase', 22, 0, 22, 'Initial workstation dock batch', 'PO-2026-0101', daysAgoIso(35, 11));
    insertMove.run(productIds[4], 'purchase', 30, 0, 30, 'Audio studio restock', 'PO-2026-0102', daysAgoIso(25, 14));
    insertMove.run(productIds[10], 'stock_in', 160, 0, 160, 'Pallet inventory check-in', 'ADJ-1004', daysAgoIso(18, 9));
    insertMove.run(productIds[6], 'damaged', -4, 4, 0, 'Damaged carton write-off during audit', 'ADJ-1011', daysAgoIso(4, 16));
    insertMove.run(productIds[13], 'sale', -6, 6, 0, 'Depleted on bulk studio order', 'INV-2026-1005', daysAgoIso(2, 13));

    const insertSale = db.prepare(
      `INSERT INTO sales (business_id, invoice_number, customer_id, customer_name, subtotal, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total_amount, amount_paid, payment_method, status, notes, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertSaleItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const salesSeed = [
      { inv: 'INV-2026-1001', custId: cust1, custName: 'Elena Rostova', daysAgo: 38, lines: [[0, 4], [1, 2], [12, 6]], disc: 5, pay: 'invoice', status: 'paid' },
      { inv: 'INV-2026-1002', custId: cust2, custName: 'Daniel Mercer', daysAgo: 26, lines: [[4, 4], [5, 2]], disc: 0, pay: 'card', status: 'paid' },
      { inv: 'INV-2026-1003', custId: cust3, custName: 'Sora Takahashi', daysAgo: 18, lines: [[10, 20], [11, 8]], disc: 10, pay: 'bank_transfer', status: 'paid' },
      { inv: 'INV-2026-1004', custId: cust4, custName: 'Olivia Bennett', daysAgo: 11, lines: [[7, 3], [8, 5], [9, 2]], disc: 0, pay: 'invoice', status: 'pending' },
      { inv: 'INV-2026-1005', custId: cust1, custName: 'Elena Rostova', daysAgo: 5, lines: [[3, 3], [13, 6]], disc: 5, pay: 'card', status: 'paid' },
      { inv: 'INV-2026-1006', custId: cust2, custName: 'Daniel Mercer', daysAgo: 2, lines: [[0, 4], [2, 5], [4, 2]], disc: 0, pay: 'card', status: 'paid' },
      { inv: 'INV-2026-1007', custId: cust4, custName: 'Olivia Bennett', daysAgo: 0, lines: [[1, 2], [12, 8]], disc: 0, pay: 'bank_transfer', status: 'paid' },
    ];

    for (const s of salesSeed) {
      let subtotal = 0;
      const lineDetails = s.lines.map(([idx, qty]) => {
        const p = productsSeed[idx];
        const lineTotal = p.sell * qty;
        subtotal += lineTotal;
        return { pId: productIds[idx], p, qty, lineTotal };
      });
      const discountAmount = Math.round(subtotal * (s.disc / 100) * 100) / 100;
      const taxable = subtotal - discountAmount;
      const taxAmount = Math.round(taxable * 0.085 * 100) / 100;
      const totalAmount = Math.round((taxable + taxAmount) * 100) / 100;
      const amountPaid = s.status === 'paid' ? totalAmount : 0;
      const createdAt = daysAgoIso(s.daysAgo, 15);

      const saleId = Number(
        insertSale.run(
          s.inv, s.custId, s.custName, subtotal, 'percent', s.disc, discountAmount, 8.5, taxAmount, totalAmount, amountPaid, s.pay, s.status, 'Standard commercial dispatch', createdAt
        ).lastInsertRowid
      );

      for (const l of lineDetails) {
        insertSaleItem.run(saleId, l.pId, l.p.name, l.p.sku, l.qty, l.p.sell, l.p.cost, l.lineTotal);
        insertMove.run(l.pId, 'sale', -l.qty, l.p.qty + l.qty, l.p.qty, `Sold on ${s.inv}`, s.inv, createdAt);
      }
    }

    const insertPO = db.prepare(
      `INSERT INTO purchases (business_id, po_number, supplier_id, supplier_name, status, subtotal, discount_amount, tax_rate, tax_amount, total_amount, expected_date, received_at, notes, created_at)
       VALUES (1, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`
    );
    const insertPOItem = db.prepare(
      `INSERT INTO purchase_items (purchase_id, product_id, product_name, sku, quantity, received_qty, unit_cost, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const po1Id = Number(
      insertPO.run('PO-2026-0101', supNordic, 'Nordic Precision Components', 'received', 6604, 6604, daysAgoIso(35).slice(0, 10), daysAgoIso(35, 11), 'Core workstation inventory replenishment', daysAgoIso(38, 9)).lastInsertRowid
    );
    insertPOItem.run(po1Id, productIds[0], productsSeed[0].name, productsSeed[0].sku, 50, 50, 74, 3700);
    insertPOItem.run(po1Id, productIds[1], productsSeed[1].name, productsSeed[1].sku, 22, 22, 132, 2904);

    const po2Id = Number(
      insertPO.run('PO-2026-0102', supVanguard, 'Vanguard Acoustics Ltd.', 'received', 2640, 2640, daysAgoIso(25).slice(0, 10), daysAgoIso(25, 14), 'Studio microphone batch', daysAgoIso(28, 10)).lastInsertRowid
    );
    insertPOItem.run(po2Id, productIds[4], productsSeed[4].name, productsSeed[4].sku, 30, 30, 88, 2640);

    const po3Id = Number(
      insertPO.run('PO-2026-0103', supMeridian, 'Meridian Silicon Supply', 'ordered', 1710, 1710, daysFromNowDate(3), null, 'Urgent Wi-Fi 6E AP restock & TB4 cables', daysAgoIso(2, 11)).lastInsertRowid
    );
    insertPOItem.run(po3Id, productIds[9], productsSeed[9].name, productsSeed[9].sku, 10, 0, 108, 1080);
    insertPOItem.run(po3Id, productIds[12], productsSeed[12].name, productsSeed[12].sku, 35, 0, 18, 630);

    const po4Id = Number(
      insertPO.run('PO-2026-0104', supApexPack, 'Apex Corrugated & Print', 'draft', 570, 570, daysFromNowDate(7), null, 'Draft packaging replenishment', daysAgoIso(1, 16)).lastInsertRowid
    );
    insertPOItem.run(po4Id, productIds[11], productsSeed[11].name, productsSeed[11].sku, 30, 0, 19, 570);

    const insertEvent = db.prepare(
      'INSERT INTO calendar_events (business_id, title, event_date, event_type, notes, completed) VALUES (1, ?, ?, ?, ?, ?)'
    );
    insertEvent.run('Expected Delivery: PO-2026-0103 (Meridian Silicon)', daysFromNowDate(3), 'delivery', '10x Wi-Fi 6E Access Points + 35x TB4 Cables arriving Dock B', 0);
    insertEvent.run('Monthly Warehouse Cycle Count', daysFromNowDate(5), 'stock_audit', 'Reconcile Audio & Packaging shelf quantities against ledger', 0);
    insertEvent.run('Kestrel Architecture Hardware Review', daysFromNowDate(1), 'reminder', 'Confirm pricing tier for quarterly workstation rollout', 0);
    insertEvent.run('Draft PO-2026-0104 Approval Deadline', daysFromNowDate(2), 'purchase', 'Finalize corrugated mailer carton order with Apex', 0);

    const insertNotif = db.prepare(
      'INSERT INTO notifications (business_id, type, title, message, related_module, dedupe_key, is_read, created_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertNotif.run('out_of_stock', 'Out of Stock: Acoustic Foam Isolation Panels', 'SKU AU-PN-355 has reached 0 units on hand (min threshold: 10).', 'inventory', `oos-${productIds[6]}`, 0, daysAgoIso(3, 16));
    insertNotif.run('out_of_stock', 'Out of Stock: Anodized Aluminum Laptop Stand', 'SKU CB-ST-712 depleted after INV-2026-1005.', 'products', `oos-${productIds[13]}`, 0, daysAgoIso(2, 13));
    insertNotif.run('low_stock', 'Low Stock Warning: Wi-Fi 6E Ceiling Access Point', 'Only 3 units remaining (min threshold: 6). PO-2026-0103 is in transit.', 'purchases', `low-${productIds[9]}`, 0, daysAgoIso(2, 11));
    insertNotif.run('low_stock', 'Low Stock Warning: Ergonomic Vertical Wireless Mouse', '7 units left against minimum stock level of 12.', 'inventory', `low-${productIds[2]}`, 0, daysAgoIso(1, 17));
    insertNotif.run('sale', 'New Invoice Completed: INV-2026-1007', 'Olivia Bennett (Foundry Coworking Labs) completed order.', 'sales', '', 1, daysAgoIso(0, 15));

    const insertAudit = db.prepare(
      `INSERT INTO audit_logs (business_id, user_id, user_name, action, entity_type, entity_id, summary, created_at)
       VALUES (1, NULL, 'System', ?, ?, ?, ?, ?)`
    );
    insertAudit.run('SEED_INIT', 'business', '1', 'Initialized StockWise Operations ledger with catalog, vendors, and historical transactions', daysAgoIso(40, 9));
  });

  seedSampleAiDocsSync();
}

function seedSampleAiDocsSync(): void {
  const aiDocCount = db
    .prepare('SELECT COUNT(*) as c FROM ai_documents WHERE business_id = 1')
    .get() as { c: number };
  if (aiDocCount.c > 0) return;

  const now = new Date().toISOString();
  const insertDoc = db.prepare(
    `INSERT OR IGNORE INTO ai_documents
      (id, business_id, title, description, document_type, source, source_key, storage_path, raw_content, content_hash, status, metadata, created_at, updated_at)
     VALUES (?, 1, ?, ?, ?, 'sample_documentation', ?, '', ?, ?, 'pending', ?, ?, ?)`
  );

  withTransaction(() => {
    for (const sample of SAMPLE_KNOWLEDGE_DOCUMENTS) {
      const cleaned = cleanExtractedText(sample.content);
      insertDoc.run(
        crypto.randomUUID(),
        sample.title,
        sample.description,
        sample.documentType,
        sample.sourceKey,
        cleaned,
        hashContent(cleaned),
        JSON.stringify({ isSampleDocumentation: true, sourceKey: sample.sourceKey }),
        now,
        now
      );
    }
  });
}

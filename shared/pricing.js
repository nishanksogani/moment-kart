export function priceCart(items, products) {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw new Error('Cart must contain between 1 and 50 items');
  const verified = items.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid item in cart');
    const product = products.find(p => String(p.id) === String(item.productId));
    if (!product) throw new Error('A product is no longer available. Please update your cart.');
    if (!product.in_stock) throw new Error(`"${product.name}" is out of stock`);
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 20) throw new Error('Quantity must be between 1 and 20');
    const dims = Array.isArray(product.dimensions) ? product.dimensions : [];
    const size = dims.find(d => d.label === item.dimension);
    if (dims.length && !size) throw new Error(`Choose an available size for "${product.name}"`);
    const price = size ? size.price_paise : product.price_paise;
    if (!Number.isSafeInteger(price) || price <= 0) throw new Error('A product price is unavailable');
    return { productId: String(product.id), name: product.name, price_paise: price, qty: item.qty, dimension: size?.label || null, message: product.customizable ? String(item.message || '').slice(0, 200) : '' };
  });
  const total_paise = verified.reduce((sum, item) => sum + item.price_paise * item.qty, 0);
  if (!Number.isSafeInteger(total_paise) || total_paise > 2147483647) throw new Error('Order total is too large');
  return { items: verified, total_paise };
}


import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectCartItems, selectCartTotal, clearCart, setCartItemVariation } from '@/store/slices/cartSlice';
import { useAuth } from '@/hooks/useAuth';
import { createOrder } from '@/services/orderService';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { ShoppingBag, Truck, ArrowLeft, Loader2, CheckCircle, Banknote, Mail, User } from 'lucide-react';
import { ShippingMethodSelector, ShippingZone, SHIPPING_RATES } from '@/components/checkout/ShippingMethodSelector';
import { useFacebookPixel } from '@/hooks/useFacebookPixel';
import { useServerTracking } from '@/hooks/useServerTracking';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProductVariation } from '@/types';

interface ShippingForm {
  name: string;
  phone: string;
  address: string;
}

interface BillingForm {
  name: string;
  email: string;
  phone: string;
}

// Generate or get session ID for tracking incomplete orders
const getSessionId = () => {
  let sessionId = localStorage.getItem('checkout_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('checkout_session_id', sessionId);
  }
  return sessionId;
};

const CheckoutPage = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const { isReady, setUserData } = useFacebookPixel();
  const { trackInitiateCheckout: trackServerCheckout } = useServerTracking();
  
  const cartItems = useAppSelector(selectCartItems);
  const cartTotal = useAppSelector(selectCartTotal);
  const hasTrackedCheckout = useRef(false);

  const [variationsByProductId, setVariationsByProductId] = useState<Record<string, ProductVariation[]>>({});
  const productIdsInCart = useMemo(
    () => Array.from(new Set(cartItems.map((i) => i.product.id))),
    [cartItems]
  );

  useEffect(() => {
    const loadVariations = async () => {
      if (productIdsInCart.length === 0) return;

      // Use already-available variations from cart items (if any)
      const preloaded: Record<string, ProductVariation[]> = {};
      for (const item of cartItems) {
        if (item.product.variations && item.product.variations.length > 0) {
          preloaded[item.product.id] = item.product.variations;
        }
      }

      try {
        const { data, error } = await supabase
          .from('product_variations')
          .select('id, product_id, name, price, original_price, stock, sort_order, is_active')
          .in('product_id', productIdsInCart)
          .eq('is_active', true)
          .order('sort_order', { ascending: true });

        if (error) throw error;

        const fetched: Record<string, ProductVariation[]> = {};
        (data || []).forEach((v: any) => {
          const pv: ProductVariation = {
            id: v.id,
            product_id: v.product_id,
            name: v.name,
            price: Number(v.price),
            original_price: v.original_price == null ? undefined : Number(v.original_price),
            stock: Number(v.stock),
            sort_order: Number(v.sort_order ?? 0),
            is_active: Boolean(v.is_active),
          };
          fetched[pv.product_id] = [...(fetched[pv.product_id] || []), pv];
        });

        setVariationsByProductId({ ...fetched, ...preloaded });
      } catch (e) {
        console.error('Failed to load variations for checkout:', e);
        setVariationsByProductId((prev) => ({ ...preloaded, ...prev }));
      }
    };

    loadVariations();
  }, [productIdsInCart, cartItems]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const draftOrderId = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shippingZone, setShippingZone] = useState<ShippingZone>('outside_dhaka');

  const [shippingForm, setShippingForm] = useState<ShippingForm>({
    name: '',
    phone: '',
    address: '',
  });

  const [billingForm, setBillingForm] = useState<BillingForm>({
    name: '',
    email: '',
    phone: '',
  });

  const shippingCost = SHIPPING_RATES[shippingZone];
  const total = cartTotal + shippingCost;

  // Load saved address if user is logged in
  useEffect(() => {
    const loadUserAddress = async () => {
      if (!user) return;
      
      const { data: addresses } = await supabase
        .from('addresses')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .maybeSingle();
      
      if (addresses) {
        setShippingForm({
          name: addresses.name,
          phone: addresses.phone,
          address: `${addresses.street}, ${addresses.city}, ${addresses.district}`,
        });
      } else {
        // Load profile info if no default address
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, phone')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (profile) {
          setShippingForm(prev => ({
            ...prev,
            name: profile.full_name || '',
            phone: profile.phone || '',
          }));
        }
      }
    };
    
    loadUserAddress();
  }, [user]);

  // Redirect to cart if empty (only on initial load, not after order placed)
  const hasPlacedOrder = useRef(false);
  
  useEffect(() => {
    if (!authLoading && cartItems.length === 0 && !hasPlacedOrder.current) {
      navigate('/cart');
    }
  }, [cartItems, authLoading, navigate]);

  // Track InitiateCheckout event once (both client and server side with same event ID)
  // Also send user data if form is filled for better match quality
  useEffect(() => {
    if (isReady && cartItems.length > 0 && !hasTrackedCheckout.current) {
      console.log('Firing InitiateCheckout event (client + server) with shared event_id');
      
      const contentIds = cartItems.map(item => item.product.id);
      const numItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
      
      // Generate shared event ID for deduplication
      const eventId = `InitiateCheckout_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      // Extract user data from form if available
      const nameParts = shippingForm.name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      // Update client-side pixel with user data if available
      if (shippingForm.phone || firstName) {
        setUserData?.({
          phone: shippingForm.phone,
          firstName,
          lastName,
        });
      }
      
      // Client-side tracking with event ID
      if (window.fbq) {
        window.fbq('track', 'InitiateCheckout', {
          content_ids: contentIds,
          num_items: numItems,
          value: cartTotal,
          currency: 'BDT',
        }, { eventID: eventId });
      }
      
      // Server-side tracking via CAPI with same event ID and user data
      trackServerCheckout({
        contentIds,
        value: cartTotal,
        numItems,
        currency: 'BDT',
        eventId,
        userData: shippingForm.phone || firstName ? {
          phone: shippingForm.phone || undefined,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
        } : undefined,
      }).then(result => {
        console.log('[CAPI] InitiateCheckout result:', result);
      }).catch(err => {
        console.error('[CAPI] InitiateCheckout error:', err);
      });
      
      hasTrackedCheckout.current = true;
    }
  }, [isReady, cartItems, cartTotal, shippingForm, setUserData, trackServerCheckout]);

  // Track user data update when phone is entered (for better match quality)
  const hasTrackedPhoneUpdate = useRef(false);
  useEffect(() => {
    // Only track once when phone is filled with a valid number
    if (!hasTrackedPhoneUpdate.current && 
        shippingForm.phone && 
        /^(\+?880)?01[3-9]\d{8}$/.test(shippingForm.phone.replace(/\s/g, '')) &&
        cartItems.length > 0) {
      
      const nameParts = shippingForm.name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      // Update client-side pixel with user data
      setUserData?.({
        phone: shippingForm.phone,
        firstName,
        lastName,
      });
      
      console.log('Updated Facebook Pixel with user data for better matching');
      hasTrackedPhoneUpdate.current = true;
    }
  }, [shippingForm.phone, shippingForm.name, cartItems.length, setUserData]);

  // Save draft order when form changes
  const saveDraftOrder = useCallback(async () => {
    if (cartItems.length === 0) return;
    
    const sessionId = getSessionId();
    const addressParts = shippingForm.address.split(',').map(p => p.trim());
    
    const draftData = {
      session_id: sessionId,
      user_id: user?.id || null,
      shipping_name: shippingForm.name || null,
      shipping_phone: shippingForm.phone || null,
      shipping_street: addressParts[0] || null,
      shipping_district: addressParts[1] || null,
      shipping_city: addressParts[2] || null,
      items: cartItems.map(item => ({
        id: item.product.id,
        name: item.product.name,
        price: item.product.price,
        quantity: item.quantity,
        image: item.product.images[0] || null,
      })),
      subtotal: cartTotal,
      shipping_cost: shippingCost,
      total: total,
    };

    try {
      if (draftOrderId.current) {
        // Update existing draft
        await supabase
          .from('draft_orders')
          .update(draftData)
          .eq('id', draftOrderId.current);
      } else {
        // Check if there's an existing draft for this session
        const { data: existing } = await supabase
          .from('draft_orders')
          .select('id')
          .eq('session_id', sessionId)
          .eq('is_converted', false)
          .maybeSingle();
        
        if (existing) {
          draftOrderId.current = existing.id;
          await supabase
            .from('draft_orders')
            .update(draftData)
            .eq('id', existing.id);
        } else {
          // Create new draft
          const { data } = await supabase
            .from('draft_orders')
            .insert([draftData])
            .select('id')
            .single();
          
          if (data) {
            draftOrderId.current = data.id;
          }
        }
      }
    } catch (error) {
      console.error('Error saving draft order:', error);
    }
  }, [cartItems, shippingForm, user, cartTotal, shippingCost, total]);

  // Debounced save on form change
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      saveDraftOrder();
    }, 1000); // Save after 1 second of no changes
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [shippingForm, cartItems, saveDraftOrder]);

  const formatPrice = (price: number) => {
    return `৳${price.toLocaleString('en-BD')}`;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setShippingForm(prev => ({ ...prev, [name]: value }));
  };

  const handleBillingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setBillingForm(prev => ({ ...prev, [name]: value }));
  };

  const validateForm = (): boolean => {
    if (!billingForm.name.trim()) {
      toast({ title: "Billing name is required", variant: "destructive" });
      return false;
    }
    if (!billingForm.phone.trim() || !/^(\+?880)?01[3-9]\d{8}$/.test(billingForm.phone.replace(/\s/g, ''))) {
      toast({ title: "Valid billing phone number is required", variant: "destructive" });
      return false;
    }
    if (billingForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingForm.email.trim())) {
      toast({ title: "Valid email address is required", variant: "destructive" });
      return false;
    }
    if (!shippingForm.name.trim()) {
      toast({ title: "Delivery name is required", variant: "destructive" });
      return false;
    }
    if (!shippingForm.phone.trim() || !/^(\+?880)?01[3-9]\d{8}$/.test(shippingForm.phone.replace(/\s/g, ''))) {
      toast({ title: "Valid delivery phone number is required", variant: "destructive" });
      return false;
    }
    if (!shippingForm.address.trim()) {
      toast({ title: "Address is required", variant: "destructive" });
      return false;
    }

    // Require size selection for products that have variations
    const missingSize = cartItems.find((item) => {
      const variations = variationsByProductId[item.product.id] || item.product.variations || [];
      return variations.length > 0 && !item.variation;
    });

    if (missingSize) {
      toast({
        title: "সাইজ নির্বাচন করুন",
        description: `${missingSize.product.name} - এর সাইজ সিলেক্ট করুন`,
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    
    try {
      // Extract first and last name from full name
      const nameParts = shippingForm.name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      // Update client-side pixel with user data for better matching
      setUserData?.({
        phone: shippingForm.phone,
        firstName,
        lastName,
      });
      
      const order = await createOrder({
        userId: user?.id || null,
        items: cartItems,
        shippingAddress: {
          name: shippingForm.name,
          phone: shippingForm.phone,
          address: shippingForm.address,
        },
        paymentMethod: 'cod',
        shippingZone: shippingZone,
      });
      
      // Mark draft order as converted
      if (draftOrderId.current) {
        await supabase
          .from('draft_orders')
          .update({ 
            is_converted: true, 
            converted_at: new Date().toISOString() 
          })
          .eq('id', draftOrderId.current);
      }
      
      // Clear session ID for next checkout
      localStorage.removeItem('checkout_session_id');
      
      // Mark as order placed before clearing cart to prevent redirect
      hasPlacedOrder.current = true;
      
      // Prepare items data for tracking on confirmation page
      const orderItems = cartItems.map(item => ({
        productId: item.product.id,
        productName: item.product.name,
        price: item.product.price,
        quantity: item.quantity,
      }));
      
      dispatch(clearCart());
      
      // Store order confirmation data in sessionStorage so it's available after payment redirect
      const confirmationData = {
        orderNumber: order.id,
        customerName: shippingForm.name,
        phone: shippingForm.phone,
        total: total,
        items: orderItems,
        numItems: cartItems.reduce((sum, item) => sum + item.quantity, 0),
        city: shippingZone === 'inside_dhaka' ? 'dhaka' : 'bangladesh',
        district: shippingZone === 'inside_dhaka' ? 'dhaka' : undefined,
      };
      // Include billing email so confirmation page can send delivery email
      (confirmationData as any).customerEmail = billingForm.email?.trim() || undefined;
      sessionStorage.setItem('pending_order_confirmation', JSON.stringify(confirmationData));

      // Initialize EPS payment via direct API
      const successUrl = `${window.location.origin}/order-confirmation`;
      const failUrl = `${window.location.origin}/payment-failed`;
      const initRes = await supabase.functions.invoke('eps-initiate', {
        body: {
          order_number: order.id,
          amount: total,
          customer_name: billingForm.name || shippingForm.name,
          customer_email: billingForm.email?.trim() || `noemail+${order.id}@pixelcraftstudio.shop`,
          customer_phone: billingForm.phone || shippingForm.phone,
          customer_address: shippingForm.address,
          product_name: cartItems[0]?.product?.name || 'Order',
          success_url: successUrl,
          fail_url: failUrl,
          cancel_url: failUrl,
        },
      });

      if (initRes.error || !initRes.data?.redirectUrl) {
        throw new Error(initRes.data?.error || initRes.error?.message || 'পেমেন্ট গেটওয়ে সমস্যা');
      }

      window.location.href = initRes.data.redirectUrl;
    } catch (error) {
      console.error('Order error:', error);
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      toast({
        title: "অর্ডার করতে সমস্যা হয়েছে",
        description: msg || "আবার চেষ্টা করুন।",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }


  return (
    <main className="min-h-screen bg-muted/30 py-8">
      <div className="container-custom">
        {/* Header */}
        <div className="mb-8">
          <Link to="/cart" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back to Cart
          </Link>
          <h1 className="font-display text-3xl font-bold text-foreground">Checkout</h1>
          {!user && (
            <p className="text-muted-foreground mt-2">
              Checking out as guest.{' '}
              <Link to="/auth" className="text-primary hover:underline">
                Sign in
              </Link>{' '}
              to track your orders.
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Left Column - Forms */}
            <div className="lg:col-span-2 space-y-6">
              {/* Billing Information */}
              <div className="bg-card rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-xl font-semibold text-foreground">Billing Information</h2>
                </div>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="billing-name">Full Name *</Label>
                    <Input
                      id="billing-name"
                      name="name"
                      placeholder="Enter your full name"
                      value={billingForm.name}
                      onChange={handleBillingChange}
                      required
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="billing-email">Email</Label>
                      <Input
                        id="billing-email"
                        name="email"
                        type="email"
                        placeholder="your@email.com"
                        value={billingForm.email}
                        onChange={handleBillingChange}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billing-phone">Phone Number *</Label>
                      <Input
                        id="billing-phone"
                        name="phone"
                        placeholder="01XXX-XXXXXX"
                        value={billingForm.phone}
                        onChange={handleBillingChange}
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Shipping Information */}
              <div className="bg-card rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <Truck className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-xl font-semibold text-foreground">Delivery Information</h2>
                </div>
                
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name *</Label>
                      <Input
                        id="name"
                        name="name"
                        placeholder="Enter your full name"
                        value={shippingForm.name}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number *</Label>
                      <Input
                        id="phone"
                        name="phone"
                        placeholder="01XXX-XXXXXX"
                        value={shippingForm.phone}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Full Address *</Label>
                    <Input
                      id="address"
                      name="address"
                      placeholder="House no, Road, Area, City, District"
                      value={shippingForm.address}
                      onChange={handleInputChange}
                      required
                    />
                  </div>

                  {/* Shipping Method Selector */}
                  <ShippingMethodSelector
                    address={shippingForm.address}
                    selectedZone={shippingZone}
                    onZoneChange={setShippingZone}
                  />
                </div>
              </div>

              {/* Payment Method - Fixed COD */}
              <div className="bg-card rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <Banknote className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-xl font-semibold text-foreground">Payment Method</h2>
                </div>
                
                <div className="flex items-center gap-4 p-4 rounded-lg border-2 border-primary bg-primary/5">
                  <Banknote className="h-6 w-6 text-primary" />
                  <div>
                    <p className="font-medium text-foreground">Cash on Delivery</p>
                    <p className="text-sm text-muted-foreground">Pay when you receive your order</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Order Summary */}
            <div className="lg:col-span-1">
              <div className="bg-card rounded-xl p-6 shadow-sm sticky top-24">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <ShoppingBag className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-xl font-semibold text-foreground">Order Summary</h2>
                </div>

                {/* Cart Items */}
                <div className="space-y-4 mb-6 max-h-64 overflow-y-auto">
                  {cartItems.map((item) => {
                    const itemKey = item.variation?.id
                      ? `${item.product.id}-${item.variation.id}`
                      : item.product.id;
                    const displayPrice = item.variation?.price ?? item.product.price;
                    const variations = variationsByProductId[item.product.id] || item.product.variations || [];

                    return (
                      <div key={itemKey} className="flex gap-3">
                        <div className="w-16 h-16 bg-muted rounded-lg overflow-hidden flex-shrink-0">
                          <img
                            src={item.product.images[0] || '/placeholder.svg'}
                            alt={item.product.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground text-sm line-clamp-2">{item.product.name}</p>

                          {variations.length > 0 && (
                            <div className="mt-2">
                              <Select
                                value={item.variation?.id}
                                onValueChange={(variationId) => {
                                  const v = variations.find((x) => x.id === variationId);
                                  if (!v) return;
                                  dispatch(
                                    setCartItemVariation({
                                      productId: item.product.id,
                                      fromVariationId: item.variation?.id,
                                      variation: v,
                                    })
                                  );
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="সাইজ নির্বাচন করুন" />
                                </SelectTrigger>
                                <SelectContent>
                                  {variations.map((v) => (
                                    <SelectItem key={v.id} value={v.id}>
                                      {v.name} — ৳{Number(v.price).toLocaleString('en-BD')}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          <p className="text-sm text-muted-foreground mt-2">Qty: {item.quantity}</p>
                        </div>
                        <p className="font-semibold text-foreground text-sm">
                          {formatPrice(displayPrice * item.quantity)}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <Separator className="my-4" />

                {/* Pricing */}
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium text-foreground">{formatPrice(cartTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Shipping ({shippingZone === 'inside_dhaka' ? 'Inside Dhaka' : 'Outside Dhaka'})
                    </span>
                    <span className="font-medium text-foreground">
                      {formatPrice(shippingCost)}
                    </span>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="flex justify-between items-center mb-6">
                  <span className="font-display text-lg font-semibold text-foreground">Total</span>
                  <span className="font-display text-2xl font-bold text-primary">{formatPrice(total)}</span>
                </div>

                <Button 
                  type="submit" 
                  className="w-full gradient-hero text-primary-foreground h-12 text-base"
                  disabled={isSubmitting || cartItems.length === 0}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      Processing...
                    </>
                  ) : (
                    <>Place Order • {formatPrice(total)}</>
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground mt-4">
                  By placing your order, you agree to our Terms of Service and Privacy Policy.
                </p>
              </div>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
};

export default CheckoutPage;

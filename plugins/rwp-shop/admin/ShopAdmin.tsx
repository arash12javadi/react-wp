import { useState } from 'react';
import { Tabs } from './common';
import CouponsAdmin from './CouponsAdmin';
import { CustomersAdmin, ReviewsAdmin } from './CustomersReviewsAdmin';
import OrdersAdmin from './OrdersAdmin';
import ReportsAdmin from './ReportsAdmin';
import SettingsAdmin from './SettingsAdmin';
import styles from './admin.module.css';

type Section = 'orders' | 'reports' | 'customers' | 'coupons' | 'reviews' | 'settings';

export default function ShopAdmin() {
  const [section, setSection] = useState<Section>(() => {
    const requested = new URLSearchParams(window.location.search).get('shop') as Section | null;
    return requested && ['orders', 'reports', 'customers', 'coupons', 'reviews', 'settings'].includes(requested) ? requested : 'orders';
  });

  return (
    <div className={styles.wrap}>
      <Tabs<Section>
        tabs={[['orders', 'Orders'], ['reports', 'Reports'], ['customers', 'Customers'], ['coupons', 'Coupons'], ['reviews', 'Reviews'], ['settings', 'Settings']]}
        active={section}
        onChange={setSection}
      />
      {section === 'orders' && <OrdersAdmin />}
      {section === 'reports' && <ReportsAdmin />}
      {section === 'customers' && <CustomersAdmin />}
      {section === 'coupons' && <CouponsAdmin />}
      {section === 'reviews' && <ReviewsAdmin />}
      {section === 'settings' && <SettingsAdmin />}
    </div>
  );
}

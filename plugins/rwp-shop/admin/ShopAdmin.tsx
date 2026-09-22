import type { RwpAdminPageProps } from '../../../src/lib/plugin-api';
import BackupAdmin from './BackupAdmin';
import CommerceAdmin from './CommerceAdmin';
import CouponsAdmin from './CouponsAdmin';
import { CustomersAdmin, ReviewsAdmin } from './CustomersReviewsAdmin';
import OrdersAdmin from './OrdersAdmin';
import ProductsAdmin from './ProductsAdmin';
import ReportsAdmin from './ReportsAdmin';
import SettingsAdmin from './SettingsAdmin';
import styles from './admin.module.css';

/** Shop, with its section chosen from the admin sidebar's submenu (see index.tsx). */
export default function ShopAdmin({ subsection }: RwpAdminPageProps) {
  return (
    <div className={styles.wrap}>
      {subsection === 'products' ? <ProductsAdmin />
        : subsection === 'reports' ? <ReportsAdmin />
          : subsection === 'customers' ? <CustomersAdmin />
            : subsection === 'coupons' ? <CouponsAdmin />
              : subsection === 'reviews' ? <ReviewsAdmin />
                : subsection === 'settings' ? <SettingsAdmin />
                  : subsection === 'backup' ? <BackupAdmin />
                  : subsection === 'offers' || subsection === 'questions' || subsection === 'alerts' || subsection === 'bundles'
                    ? <CommerceAdmin section={subsection} />
                  : <OrdersAdmin />}
    </div>
  );
}

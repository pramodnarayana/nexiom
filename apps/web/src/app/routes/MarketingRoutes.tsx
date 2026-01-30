import { Route } from 'react-router-dom';
import { LandingPage } from '../../modules/marketing/pages/LandingPage';
import { AppRoutes } from '../../shared/lib/auth/constants';

export function MarketingRoutes() {
    return (
        <Route path={AppRoutes.ROOT} element={<LandingPage />} />
    );
}

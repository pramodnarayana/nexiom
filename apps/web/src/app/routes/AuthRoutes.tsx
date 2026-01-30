import { Route } from 'react-router-dom';
import { LoginPage } from '../../modules/identity/pages/LoginPage';
import { SignupPage } from '../../modules/identity/pages/SignupPage';
import { AcceptInvitePage } from '../../modules/identity/pages/AcceptInvitePage';
import { ForgotPasswordPage } from '../../modules/identity/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../../modules/identity/pages/ResetPasswordPage';
import { AppRoutes } from '../../shared/lib/auth/constants';

export function AuthRoutes() {
    return (
        <>
            <Route path={AppRoutes.AUTH.LOGIN} element={<LoginPage />} />
            <Route path={AppRoutes.AUTH.SIGNUP} element={<SignupPage />} />
            <Route path={AppRoutes.AUTH.INVITE_ACCEPT} element={<AcceptInvitePage />} />
            <Route path={AppRoutes.AUTH.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
            <Route path={AppRoutes.AUTH.RESET_PASSWORD} element={<ResetPasswordPage />} />
        </>
    );
}

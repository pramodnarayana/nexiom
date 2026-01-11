import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Building2,
    Activity,
    Server,
    AlertCircle,
    TrendingUp,
    TrendingDown,
    Clock
} from 'lucide-react';

export function AdminDashboardPage() {
    const stats = [
        {
            label: 'Total Organizations',
            value: '142',
            icon: Building2,
            color: 'text-blue-600',
            bgColor: 'bg-blue-100 dark:bg-blue-900/50',
            trend: '+12%',
            trendUp: true
        },
        {
            label: 'Active Syncs (24h)',
            value: '1.2M',
            icon: Activity,
            color: 'text-green-600',
            bgColor: 'bg-green-100 dark:bg-green-900/50',
            trend: '+5%',
            trendUp: true
        },
        {
            label: 'Server Health',
            value: '99.99%',
            icon: Server,
            color: 'text-purple-600',
            bgColor: 'bg-purple-100 dark:bg-purple-900/50',
            trend: 'Stable',
            trendUp: true
        },
        {
            label: 'Support Tickets',
            value: '8',
            icon: AlertCircle,
            color: 'text-orange-600',
            bgColor: 'bg-orange-100 dark:bg-orange-900/50',
            trend: '-2',
            trendUp: false
        },
    ];

    const activities = [
        { id: 1, time: '10 mins ago', org: 'Envoy Logistics', action: 'Updated QuickBooks Connection credentials', type: 'info' },
        { id: 2, time: '2 hours ago', org: 'Acme Freight', action: 'Provisioned new tenant environment', type: 'success' },
        { id: 3, time: '5 hours ago', org: 'Zippy Transport', action: 'Failed sync attempt (Retry scheduled)', type: 'error' },
        { id: 4, time: '1 day ago', org: 'Global Shipping', action: 'User "Sarah" added to organization', type: 'info' },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Dashboard</h1>

            </div>

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat, i) => (
                    <Card key={i} className="transition-all duration-200 hover:shadow-lg hover:-translate-y-1 border-slate-200 dark:border-slate-800">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                {stat.label}
                            </CardTitle>
                            <div className={`p-2 rounded-full ${stat.bgColor}`}>
                                <stat.icon className={`h-4 w-4 ${stat.color}`} />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">{stat.value}</div>
                            <div className="flex items-center text-xs mt-1">
                                {stat.trend === 'Stable' ? (
                                    <Badge variant="outline" className="text-slate-500 border-slate-200 bg-slate-50">
                                        {stat.trend}
                                    </Badge>
                                ) : (
                                    <span className={`flex items-center font-medium ${stat.trendUp ? 'text-green-600' : 'text-orange-600'}`}>
                                        {stat.trendUp ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                                        {stat.trend}
                                    </span>
                                )}
                                <span className="text-slate-400 ml-2">vs last month</span>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Recent Activity */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card className="col-span-2 border-slate-200 dark:border-slate-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5 text-slate-500" />
                            Recent System Activity
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-0">
                            {activities.map((activity, i) => (
                                <div key={activity.id} className={`flex items-start gap-4 py-4 ${i !== activities.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}>
                                    <div className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 
                                        ${activity.type === 'success' ? 'bg-green-500' :
                                            activity.type === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}
                                    />
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{activity.org}</span>
                                            <span className="text-xs text-slate-400">• {activity.time}</span>
                                        </div>
                                        <p className="text-sm text-slate-600 dark:text-slate-300">
                                            {activity.action}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Quick Actions / Getting Started (Optional Placeholder matching generic dashboards) */}
                <Card className="col-span-1 border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
                    <CardHeader>
                        <CardTitle>System Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">API Latency</span>
                            <span className="font-medium text-green-600">45ms</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">Database</span>
                            <span className="font-medium text-green-600">Healthy</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">Worker Nodes</span>
                            <span className="font-medium text-green-600">3/3 Online</span>
                        </div>
                        <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800">
                            <div className="text-xs text-slate-400 text-center">System v3.3.1</div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

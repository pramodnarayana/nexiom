import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Users,
    Activity,
    CreditCard,
    TrendingUp,
    Shield
} from 'lucide-react';

export function DashboardPage() {
    // In a real app, we would fetch this data from the API based on the Tenant Context
    const stats = [
        {
            label: 'Total Members',
            value: '12',
            icon: Users,
            color: 'text-blue-600',
            bgColor: 'bg-blue-100 dark:bg-blue-900/50',
            trend: '+2',
            trendUp: true
        },
        {
            label: 'Active Sessions',
            value: '5',
            icon: Activity,
            color: 'text-green-600',
            bgColor: 'bg-green-100 dark:bg-green-900/50',
            trend: 'Now',
            trendUp: true
        },
        {
            label: 'Subscription',
            value: 'Pro Plan',
            icon: CreditCard,
            color: 'text-purple-600',
            bgColor: 'bg-purple-100 dark:bg-purple-900/50',
            trend: 'Active',
            trendUp: true
        },
        {
            label: 'Security Score',
            value: '98%',
            icon: Shield,
            color: 'text-orange-600',
            bgColor: 'bg-orange-100 dark:bg-orange-900/50',
            trend: '+5%',
            trendUp: true
        },
    ];

    return (
        <div className="space-y-6">


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
                                {stat.trend === 'Active' || stat.trend === 'Now' ? (
                                    <Badge variant="outline" className="text-slate-500 border-slate-200 bg-slate-50">
                                        {stat.trend}
                                    </Badge>
                                ) : (
                                    <span className={`flex items-center font-medium ${stat.trendUp ? 'text-green-600' : 'text-orange-600'}`}>
                                        <TrendingUp className="h-3 w-3 mr-1" />
                                        {stat.trend}
                                    </span>
                                )}
                                {/* <span className="text-slate-400 ml-2">vs last month</span> */}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Placeholder for Quick Actions or Activity */}
            <Card className="border border-dashed border-slate-300 shadow-none bg-slate-50/50">
                <CardContent className="flex flex-col items-center justify-center p-12 text-center text-slate-500">
                    <Activity className="h-10 w-10 mb-4 opacity-20" />
                    <h3 className="text-lg font-semibold">Activity Feed</h3>
                    <p className="text-sm">Recent organization activity will appear here.</p>
                </CardContent>
            </Card>
        </div>
    );
}

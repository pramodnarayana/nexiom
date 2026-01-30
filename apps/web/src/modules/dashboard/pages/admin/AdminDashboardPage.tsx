import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
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
            label: 'Total Tenants',
            value: '142',
            icon: Building2,
            color: 'text-primary',
            bgColor: 'bg-primary/10',
            trend: '+12%',
            trendUp: true
        },
        {
            label: 'Active Syncs (24h)',
            value: '1.2M',
            icon: Activity,
            color: 'text-success',
            bgColor: 'bg-success/10',
            trend: '+5%',
            trendUp: true
        },
        {
            label: 'Server Health',
            value: '99.99%',
            icon: Server,
            color: 'text-primary',
            bgColor: 'bg-primary/10',
            trend: 'Stable',
            trendUp: true
        },
        {
            label: 'Support Tickets',
            value: '8',
            icon: AlertCircle,
            color: 'text-warning',
            bgColor: 'bg-warning/10',
            trend: '-2',
            trendUp: false
        },
    ];

    const activities = [
        { id: 1, time: '10 mins ago', org: 'Envoy Logistics', action: 'Updated QuickBooks Connection credentials', type: 'info' },
        { id: 2, time: '2 hours ago', org: 'Acme Freight', action: 'Provisioned new tenant environment', type: 'success' },
        { id: 3, time: '5 hours ago', org: 'Zippy Transport', action: 'Failed sync attempt (Retry scheduled)', type: 'error' },
        { id: 4, time: '1 day ago', org: 'Global Shipping', action: 'User "Sarah" added to tenant', type: 'info' },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
            </div>

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat, i) => (
                    <Card key={i} className="transition-all duration-200 hover:shadow-lg hover:-translate-y-1 border-border">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {stat.label}
                            </CardTitle>
                            <div className={`p-2 rounded-full ${stat.bgColor}`}>
                                <stat.icon className={`h-4 w-4 ${stat.color}`} />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                            <div className="flex items-center text-xs mt-1">
                                {stat.trend === 'Stable' ? (
                                    <Badge variant="outline" className="text-muted-foreground border-border bg-muted/50">
                                        {stat.trend}
                                    </Badge>
                                ) : (
                                    <span className={`flex items-center font-medium ${stat.trendUp ? 'text-success' : 'text-warning'}`}>
                                        {stat.trendUp ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                                        {stat.trend}
                                    </span>
                                )}
                                <span className="text-muted-foreground ml-2">vs last month</span>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Recent Activity */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card className="col-span-2 border-border">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-foreground">
                            <Clock className="h-5 w-5 text-muted-foreground" />
                            Recent System Activity
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-0">
                            {activities.map((activity, i) => (
                                <div key={activity.id} className={`flex items-start gap-4 py-4 ${i !== activities.length - 1 ? 'border-b border-border' : ''}`}>
                                    <div className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 
                                        ${activity.type === 'success' ? 'bg-success' :
                                            activity.type === 'error' ? 'bg-destructive' : 'bg-primary'}`}
                                    />
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm text-foreground">{activity.org}</span>
                                            <span className="text-xs text-muted-foreground">• {activity.time}</span>
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {activity.action}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Quick Actions / Getting Started */}
                <Card className="col-span-1 border-border bg-muted/20">
                    <CardHeader>
                        <CardTitle className="text-foreground">System Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">API Latency</span>
                            <span className="font-medium text-success">45ms</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Database</span>
                            <span className="font-medium text-success">Healthy</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Worker Nodes</span>
                            <span className="font-medium text-success">3/3 Online</span>
                        </div>
                        <div className="pt-4 mt-4 border-t border-border">
                            <div className="text-xs text-muted-foreground text-center">System v3.3.1</div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

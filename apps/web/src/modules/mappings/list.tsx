import { useTable, useDelete } from '@refinedev/core';
import { Link } from 'react-router-dom';

export const MappingsList = () => {
  const { tableQueryResult } = useTable({
    resource: 'admin/mappings',
  });
  const { mutate: deleteMapping } = useDelete();

  return (
    <div className="p-6 bg-white rounded-lg shadow min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Canonical Mappings</h1>
        <Link
          to="/admin/mappings/create"
          className="bg-black text-white px-4 py-2 rounded-md hover:bg-gray-800 transition"
        >
          Create Mapping
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-gray-500">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50">
            <tr>
              <th className="px-6 py-3">App Name</th>
              <th className="px-6 py-3">Category</th>
              <th className="px-6 py-3">Entity</th>
              <th className="px-6 py-3">View Mode</th>
              <th className="px-6 py-3">Tenant Override</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tableQueryResult.data?.data.map((mapping: Record<string, string>) => (
              <tr key={mapping.id} className="bg-white border-b">
                <td className="px-6 py-4 font-medium text-gray-900">{mapping.appName}</td>
                <td className="px-6 py-4">{mapping.category}</td>
                <td className="px-6 py-4 font-mono">{mapping.entity}</td>
                <td className="px-6 py-4">{mapping.viewMode}</td>
                <td className="px-6 py-4">{mapping.tenantId ? <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">{mapping.tenantId}</span> : <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">Global</span>}</td>
                <td className="px-6 py-4 text-right">
                  <Link
                    to={`/admin/mappings/edit/${mapping.id}`}
                    className="text-blue-600 hover:text-blue-900 mr-4"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this mapping?')) {
                        deleteMapping({ resource: 'admin/mappings', id: mapping.id });
                      }
                    }}
                    className="text-red-600 hover:text-red-900"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

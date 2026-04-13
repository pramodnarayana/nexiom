import { useCreate } from '@refinedev/core';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

export const MappingsCreate = () => {
  const navigate = useNavigate();
  const { mutate } = useCreate();
  const { register, handleSubmit, formState: { errors } } = useForm();

  const onFinish = (data: Record<string, unknown>) => {
    mutate(
      {
        resource: 'admin/mappings',
        values: data,
      },
      {
        onSuccess: () => navigate('/admin/mappings'),
      }
    );
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Canonical Mapping</h1>
      <form onSubmit={handleSubmit(onFinish)} className="space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">App Name</label>
            <input
              {...register('appName', { required: true })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-black focus:ring-black sm:text-sm border p-2"
              placeholder="e.g. salesforce"
            />
            {errors.appName && <span className="text-red-500 text-xs">Required</span>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Category</label>
            <input
              {...register('category', { required: true })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-black focus:ring-black sm:text-sm border p-2"
              placeholder="e.g. TMS"
            />
            {errors.category && <span className="text-red-500 text-xs">Required</span>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Entity</label>
            <input
              {...register('entity', { required: true })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-black focus:ring-black sm:text-sm border p-2"
              placeholder="e.g. rtms__Load__c"
            />
            {errors.entity && <span className="text-red-500 text-xs">Required</span>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">View Mode</label>
            <input
              {...register('viewMode', { required: true })}
              defaultValue="summary"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-black focus:ring-black sm:text-sm border p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Tenant Override (Optional)</label>
            <input
              {...register('tenantId')}
              placeholder="Leave blank for Global"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-black focus:ring-black sm:text-sm border p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Version</label>
            <input
              {...register('version')}
              defaultValue="v1"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-black focus:ring-black sm:text-sm border p-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Mapping Config (JSON)</label>
          <textarea
            {...register('mappingConfig', { 
                required: true,
                setValueAs: (v: string) => { try { return JSON.parse(v); } catch { return v; } }
            })}
            rows={15}
            placeholder='{\n  "id": "rtms__Load__c.Id"\n}'
            className="w-full text-sm font-mono border rounded p-4 border-gray-300 focus:border-black focus:ring-black"
          />
        </div>

        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => navigate('/admin/mappings')}
            className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50 bg-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800"
          >
            Save Mapping
          </button>
        </div>
      </form>
    </div>
  );
};

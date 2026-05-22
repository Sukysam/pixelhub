from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0018_data_rbac_permissions'),
    ]

    operations = [
        migrations.RenameIndex(
            model_name='accesstoken',
            new_name='core_access_user_id_962db7_idx',
            old_name='core_access_user_id_4c87f7_idx',
        ),
        migrations.RenameIndex(
            model_name='accesstoken',
            new_name='core_access_key_1b9221_idx',
            old_name='core_access_key_7a5943_idx',
        ),
        migrations.RenameIndex(
            model_name='accesstoken',
            new_name='core_access_revoked_e32ac4_idx',
            old_name='core_access_revoked_1d6e2c_idx',
        ),
        migrations.RenameIndex(
            model_name='businessmembership',
            new_name='core_busine_user_id_f22162_idx',
            old_name='core_busine_user_id_1d0d7f_idx',
        ),
        migrations.RenameIndex(
            model_name='documentdelivery',
            new_name='core_docume_documen_e18c2e_idx',
            old_name='core_docume_document_47d4a9_idx',
        ),
        migrations.RenameIndex(
            model_name='documentdelivery',
            new_name='core_docume_documen_c83d50_idx',
            old_name='core_docume_document_5b1e9f_idx',
        ),
        migrations.RenameIndex(
            model_name='documentdelivery',
            new_name='core_docume_status_ccd86c_idx',
            old_name='core_docume_status_7b4d89_idx',
        ),
        migrations.RenameIndex(
            model_name='paymenttransaction',
            new_name='core_paymen_invoice_8bbd96_idx',
            old_name='core_payme_invoice_2ae79b_idx',
        ),
        migrations.RenameIndex(
            model_name='paymenttransaction',
            new_name='core_paymen_provide_f20d66_idx',
            old_name='core_payme_provider_3de9c1_idx',
        ),
        migrations.RenameIndex(
            model_name='paymenttransaction',
            new_name='core_paymen_provide_3626b2_idx',
            old_name='core_payme_provider_1b7f1d_idx',
        ),
        migrations.RenameIndex(
            model_name='paymentwebhookevent',
            new_name='core_paymen_provide_8e1b44_idx',
            old_name='core_payme_provider_1445b0_idx',
        ),
        migrations.RenameIndex(
            model_name='paymentwebhookevent',
            new_name='core_paymen_provide_4624b8_idx',
            old_name='core_payme_provider_3e3a05_idx',
        ),
        migrations.RenameIndex(
            model_name='savedinvoiceview',
            new_name='core_savedi_user_id_286340_idx',
            old_name='core_savedin_user_id_8c84d4_idx',
        ),
        migrations.AlterField(
            model_name='auditlog',
            name='action',
            field=models.CharField(choices=[('create', 'Create'), ('update', 'Update'), ('delete', 'Delete'), ('bulk_delete', 'Bulk Delete'), ('export', 'Export'), ('import', 'Import'), ('security', 'Security Event')], max_length=20),
        ),
        migrations.AlterField(
            model_name='documentdelivery',
            name='channel',
            field=models.CharField(choices=[('print', 'Print'), ('email', 'Email'), ('share', 'Share Link')], max_length=20),
        ),
    ]
